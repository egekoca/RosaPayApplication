import {p256} from '@noble/curves/nist.js';
import {Keypair} from '@stellar/stellar-sdk';
import {afterEach, describe, expect, it} from 'vitest';
import {buildApp} from '../src/app';
import {createDeviceAuthResolver} from '../src/application/AuthContext';
import {
  DeviceAuthService,
  InMemoryDeviceAuthRepository,
} from '../src/application/DeviceAuthService';
import {InMemoryWalletRepository} from '../src/application/WalletRepository';
import {WalletProvisioningService} from '../src/application/WalletProvisioningService';
import {InMemoryIntentRepository} from '../src/infrastructure/InMemoryIntentRepository';
import {InMemoryMerchantProfileRepository} from '../src/infrastructure/InMemoryMerchantProfileRepository';
import {createStellarConfig} from '@rosapay/stellar';

/**
 * Whether two people can use this at the same time.
 *
 * A room demonstrating the app is behind one router, so every phone arrives
 * from the same address. Limits counted by address turn a crowd into a single
 * caller and lock out everyone after the first few - which is not a theoretical
 * failure, it is what a launch day looks like.
 */

const sessionSecret = 'test-session-secret-that-is-at-least-32-bytes';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

function device() {
  const privateKey = p256.utils.randomSecretKey();
  const point = Buffer.from(p256.getPublicKey(privateKey, false));
  return {privateKey, publicSigner: point.toString('base64')};
}

function toDer(compact: Uint8Array): string {
  const integer = (bytes: Uint8Array) => {
    let value = bytes;
    while (value.length > 1 && value[0] === 0) value = value.subarray(1);
    if ((value[0] ?? 0) & 0x80) value = Uint8Array.from([0, ...value]);
    return Uint8Array.from([0x02, value.length, ...value]);
  };
  const body = Uint8Array.from([...integer(compact.subarray(0, 32)), ...integer(compact.subarray(32))]);
  return Buffer.from(Uint8Array.from([0x30, body.length, ...body])).toString('base64');
}

function testContext() {
  const wallets = new InMemoryWalletRepository();
  const deviceAuth = new DeviceAuthService(new InMemoryDeviceAuthRepository(), sessionSecret);
  const app = buildApp({
    repository: new InMemoryIntentRepository(),
    merchantProfiles: new InMemoryMerchantProfileRepository(),
    walletRepository: wallets,
    wallets: new WalletProvisioningService({
      config: createStellarConfig('testnet'),
      wallets,
      walletWasmHash: 'aa'.repeat(32),
      deployerSecret: Keypair.random().secret(),
    }),
    deviceAuth,
    auth: {
      required: true,
      resolve: createDeviceAuthResolver(deviceAuth, new InMemoryMerchantProfileRepository(), wallets),
    },
  });
  apps.push(app);
  return {app, deviceAuth};
}

/** One phone signing in, exactly as the app does. */
async function signIn(app: ReturnType<typeof buildApp>, key: ReturnType<typeof device>) {
  const challenge = await app.inject({
    method: 'POST',
    url: '/v1/auth/challenges',
    payload: {publicSigner: key.publicSigner},
  });
  expect(challenge.statusCode).toBe(201);
  const {challengeId, challenge: digest} = challenge.json();
  const signature = p256.sign(Uint8Array.from(Buffer.from(digest, 'base64')), key.privateKey, {
    prehash: false,
    lowS: true,
  });
  const session = await app.inject({
    method: 'POST',
    url: '/v1/auth/sessions',
    payload: {challengeId, publicSigner: key.publicSigner, signature: toDer(signature)},
  });
  expect(session.statusCode).toBe(201);
  return session.json().token as string;
}

describe('more than one person, one network', () => {
  it('gives each phone its own relayer budget rather than one for the room', async () => {
    const {app} = testContext();
    const first = await signIn(app, device());
    const second = await signIn(app, device());

    // The relayer allows thirty a minute. Spend the first phone's whole budget.
    const spend = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/relayer/transactions',
        headers: {authorization: `Bearer ${token}`},
        payload: {xdr: 'not-a-transaction'},
      });

    let exhausted = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await spend(first);
      if (response.statusCode === 429) {
        exhausted = true;
        break;
      }
    }
    expect(exhausted).toBe(true);

    // The second phone is on the same address and must be unaffected. Anything
    // but 429 means it was let through and refused on its own merits.
    const other = await spend(second);
    expect(other.statusCode).not.toBe(429);
  });

  it('lets a fourth phone create a wallet, which an address-wide limit would not', async () => {
    const {app} = testContext();

    // Wallet provisioning allows three an hour. Four different phones is a
    // perfectly ordinary morning and used to be a lockout.
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const key = device();
      const token = await signIn(app, key);
      const response = await app.inject({
        method: 'POST',
        url: '/v1/wallets',
        headers: {authorization: `Bearer ${token}`},
        payload: {devicePublicKey: key.publicSigner},
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.filter(status => status === 429)).toEqual([]);
  });

  it('still stops one phone driving the relayer in a loop', async () => {
    const {app} = testContext();
    const token = await signIn(app, device());

    let refused = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/relayer/transactions',
        headers: {authorization: `Bearer ${token}`},
        payload: {xdr: 'not-a-transaction'},
      });
      if (response.statusCode === 429) {
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
  });

  it('signs in many phones without the address running out of challenges', async () => {
    const {app} = testContext();
    // Authentication allows ten a minute. Twelve people arriving together is
    // not an attack.
    for (let index = 0; index < 12; index += 1) {
      await expect(signIn(app, device())).resolves.toEqual(expect.any(String));
    }
  });
});
