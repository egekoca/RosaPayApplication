import {p256} from '@noble/curves/nist.js';
import {Keypair} from '@stellar/stellar-sdk';
import {afterEach, describe, expect, it} from 'vitest';
import {buildApp} from '../src/app';
import {createDeviceAuthResolver} from '../src/application/AuthContext';
import {
  canonicalizeDevicePublicSigner,
  DeviceAuthService,
  InMemoryDeviceAuthRepository,
} from '../src/application/DeviceAuthService';
import {InMemoryWalletRepository} from '../src/application/WalletRepository';
import {WalletProvisioningService} from '../src/application/WalletProvisioningService';
import {InMemoryIntentRepository} from '../src/infrastructure/InMemoryIntentRepository';
import {InMemoryMerchantProfileRepository} from '../src/infrastructure/InMemoryMerchantProfileRepository';
import {createStellarConfig} from '@rosapay/stellar';

const sessionSecret = 'test-session-secret-that-is-at-least-32-bytes';
const ownerWallet = 'CAFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUTSM';
const otherWallet = 'CAFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQX4KO';
const merchantProfileId = '01K36YATYFVQBPR08G2YT29C3S';
const otherMerchantProfileId = '01K36YATYFVQBPR08G2YT29C3T';
const intentId = '01K36YB37NXM4X4TECF0VKP1M9';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

function device({android = false}: {android?: boolean} = {}) {
  const privateKey = p256.utils.randomSecretKey();
  const point = Buffer.from(p256.getPublicKey(privateKey, false));
  return {
    privateKey,
    canonicalSigner: point.toString('base64'),
    publicSigner: android ? Buffer.concat([Buffer.alloc(26, 0x30), point]).toString('base64') : point.toString('base64'),
  };
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
  const repository = new InMemoryIntentRepository();
  const merchants = new InMemoryMerchantProfileRepository();
  const wallets = new InMemoryWalletRepository();
  const deviceAuth = new DeviceAuthService(new InMemoryDeviceAuthRepository(), sessionSecret);
  const app = buildApp({
    repository,
    merchantProfiles: merchants,
    walletRepository: wallets,
    wallets: new WalletProvisioningService({
      config: createStellarConfig('testnet'),
      wallets,
      walletWasmHash: 'aa'.repeat(32),
      deployerSecret: Keypair.random().secret(),
    }),
    deviceAuth,
    auth: {required: true, resolve: createDeviceAuthResolver(deviceAuth, merchants, wallets)},
  });
  apps.push(app);
  return {app, deviceAuth, wallets};
}

async function createSession(app: ReturnType<typeof buildApp>, key: ReturnType<typeof device>) {
  const challenge = await app.inject({
    method: 'POST',
    url: '/v1/auth/challenges',
    payload: {publicSigner: key.publicSigner},
  });
  expect(challenge.statusCode).toBe(201);
  const challengeBody = challenge.json<{challengeId: string; challenge: string}>();
  const signature = toDer(p256.sign(Buffer.from(challengeBody.challenge, 'base64'), key.privateKey, {prehash: false}));
  const request = {
    challengeId: challengeBody.challengeId,
    publicSigner: key.publicSigner,
    signature,
  };
  const session = await app.inject({method: 'POST', url: '/v1/auth/sessions', payload: request});
  expect(session.statusCode).toBe(201);
  return {request, token: session.json<{token: string}>().token};
}

async function bindWallet(
  wallets: InMemoryWalletRepository,
  auth: DeviceAuthService,
  token: string,
  publicSigner: string,
  contractAddress: string,
) {
  const principal = auth.verifySession(token);
  if (!principal) throw new Error('Expected a valid test session');
  await wallets.save({
    contractAddress,
    publicSigner: canonicalizeDevicePublicSigner(publicSigner),
    network: 'testnet',
    status: 'active',
    userId: principal.userId,
  });
}

function merchantProfile(id: string, recipient: string) {
  return {
    id,
    displayName: id === merchantProfileId ? 'Rose Coffee' : 'Other Shop',
    recipient,
    signingKey: Keypair.random().publicKey(),
    network: 'testnet',
  };
}

function signedIntent(signingKey: string) {
  return {
    intent: {
      version: 'RTP/1',
      intentId,
      network: 'testnet',
      merchantProfileId,
      merchantName: 'Rose Coffee',
      merchantSigningKey: signingKey,
      recipient: ownerWallet,
      asset: {type: 'native', code: 'XLM', decimals: 7},
      amount: '1',
      reference: 'Table 08',
      nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
      expiresAtLedger: 1_500_120,
      createdAt: '2026-08-21T00:00:00.000Z',
    },
    signature: 'signed-intent-fixture',
  };
}

describe('device-authenticated API routes', () => {
  it('accepts an Android SPKI proof and binds profile and wallet operations to that device', async () => {
    const {app, deviceAuth, wallets} = testContext();
    const key = device({android: true});
    const {token} = await createSession(app, key);
    await bindWallet(wallets, deviceAuth, token, key.publicSigner, ownerWallet);

    const profile = merchantProfile(merchantProfileId, ownerWallet);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant-profiles',
      headers: {authorization: `Bearer ${token}`},
      payload: profile,
    });
    expect(created.statusCode).toBe(201);

    const provisioned = await app.inject({
      method: 'POST',
      url: '/v1/wallets',
      headers: {authorization: `Bearer ${token}`},
      payload: {devicePublicKey: key.publicSigner},
    });
    expect(provisioned.statusCode).toBe(201);
    expect(provisioned.json()).toMatchObject({walletContractId: ownerWallet, reused: true});

    const intent = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {authorization: `Bearer ${token}`, 'idempotency-key': 'authenticated-intent-1'},
      payload: signedIntent(profile.signingKey),
    });
    expect(intent.statusCode).toBe(201);
  });

  it('rejects replayed challenges plus missing and tampered bearer sessions', async () => {
    const {app} = testContext();
    const key = device();
    const {request, token} = await createSession(app, key);

    const replay = await app.inject({method: 'POST', url: '/v1/auth/sessions', payload: request});
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('DEVICE_AUTHENTICATION_FAILED');

    for (const authorization of [undefined, `Bearer ${token}x`]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/merchant-profiles',
        ...(authorization ? {headers: {authorization}} : {}),
        payload: merchantProfile(merchantProfileId, ownerWallet),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('prevents another device from authorizing or submitting a wallet payment', async () => {
    const {app, deviceAuth, wallets} = testContext();
    const owner = device();
    const attacker = device();
    const ownerSession = await createSession(app, owner);
    const attackerSession = await createSession(app, attacker);
    await bindWallet(wallets, deviceAuth, ownerSession.token, owner.publicSigner, ownerWallet);
    await bindWallet(wallets, deviceAuth, attackerSession.token, attacker.publicSigner, otherWallet);

    const profile = merchantProfile(merchantProfileId, ownerWallet);
    await app.inject({
      method: 'POST', url: '/v1/merchant-profiles',
      headers: {authorization: `Bearer ${ownerSession.token}`}, payload: profile,
    });
    await app.inject({
      method: 'POST', url: '/v1/payment-intents',
      headers: {authorization: `Bearer ${ownerSession.token}`, 'idempotency-key': 'authenticated-intent-2'},
      payload: signedIntent(profile.signingKey),
    });

    const deniedAuthorization = await app.inject({
      method: 'POST', url: `/v1/payment-intents/${intentId}/authorize`,
      headers: {authorization: `Bearer ${attackerSession.token}`}, payload: {authorizer: ownerWallet},
    });
    expect(deniedAuthorization.statusCode).toBe(403);

    const authorized = await app.inject({
      method: 'POST', url: `/v1/payment-intents/${intentId}/authorize`,
      headers: {authorization: `Bearer ${ownerSession.token}`}, payload: {authorizer: ownerWallet},
    });
    expect(authorized.statusCode).toBe(200);

    const deniedSubmission = await app.inject({
      method: 'POST', url: `/v1/payment-intents/${intentId}/submit`,
      headers: {authorization: `Bearer ${attackerSession.token}`}, payload: {transactionHash: 'a'.repeat(64)},
    });
    expect(deniedSubmission.statusCode).toBe(403);
  });

  it('prevents a different merchant from supplying the countersignature', async () => {
    const {app, deviceAuth, wallets} = testContext();
    const owner = device();
    const other = device();
    const ownerSession = await createSession(app, owner);
    const otherSession = await createSession(app, other);
    await bindWallet(wallets, deviceAuth, ownerSession.token, owner.publicSigner, ownerWallet);
    await bindWallet(wallets, deviceAuth, otherSession.token, other.publicSigner, otherWallet);

    const profile = merchantProfile(merchantProfileId, ownerWallet);
    await app.inject({
      method: 'POST', url: '/v1/merchant-profiles',
      headers: {authorization: `Bearer ${ownerSession.token}`}, payload: profile,
    });
    await app.inject({
      method: 'POST', url: '/v1/merchant-profiles',
      headers: {authorization: `Bearer ${otherSession.token}`},
      payload: merchantProfile(otherMerchantProfileId, otherWallet),
    });
    await app.inject({
      method: 'POST', url: '/v1/payment-intents',
      headers: {authorization: `Bearer ${ownerSession.token}`, 'idempotency-key': 'authenticated-intent-3'},
      payload: signedIntent(profile.signingKey),
    });

    const denied = await app.inject({
      method: 'POST', url: `/v1/payment-intents/${intentId}/countersignature`,
      headers: {authorization: `Bearer ${otherSession.token}`},
      payload: {customerAddress: ownerWallet, signature: Buffer.alloc(64).toString('base64')},
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('CAPABILITY_DENIED');
  });
});
