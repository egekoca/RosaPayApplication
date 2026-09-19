import {p256} from '@noble/curves/nist.js';
import {describe, expect, it} from 'vitest';
import {
  DeviceAuthenticationError,
  DeviceAuthService,
  InMemoryDeviceAuthRepository,
} from '../src/application/DeviceAuthService';

const secret = 'test-session-secret-that-is-at-least-32-bytes';

function toDer(compact: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let value = bytes;
    while (value.length > 1 && value[0] === 0) value = value.subarray(1);
    if ((value[0] ?? 0) & 0x80) value = Uint8Array.from([0, ...value]);
    return Uint8Array.from([0x02, value.length, ...value]);
  };
  const body = Uint8Array.from([...integer(compact.subarray(0, 32)), ...integer(compact.subarray(32))]);
  return Uint8Array.from([0x30, body.length, ...body]);
}

function device() {
  const privateKey = p256.utils.randomSecretKey();
  return {
    privateKey,
    publicSigner: Buffer.from(p256.getPublicKey(privateKey, false)).toString('base64'),
  };
}

describe('device authentication', () => {
  it('issues a short-lived session only after proof of possession', async () => {
    const repository = new InMemoryDeviceAuthRepository();
    const auth = new DeviceAuthService(repository, secret);
    const key = device();
    const challenge = await auth.challenge(key.publicSigner);
    const compact = p256.sign(Buffer.from(challenge.challenge, 'base64'), key.privateKey, {prehash: false});

    const session = await auth.createSession({
      challengeId: challenge.challengeId,
      publicSigner: key.publicSigner,
      signature: Buffer.from(toDer(compact)).toString('base64'),
    });

    expect(auth.verifySession(session.token)).toMatchObject({publicSigner: key.publicSigner});
    expect(repository.users.size).toBe(1);
  });

  it('consumes a challenge exactly once', async () => {
    const auth = new DeviceAuthService(new InMemoryDeviceAuthRepository(), secret);
    const key = device();
    const challenge = await auth.challenge(key.publicSigner);
    const signature = Buffer.from(toDer(
      p256.sign(Buffer.from(challenge.challenge, 'base64'), key.privateKey, {prehash: false}),
    )).toString('base64');
    const request = {challengeId: challenge.challengeId, publicSigner: key.publicSigner, signature};

    await auth.createSession(request);
    await expect(auth.createSession(request)).rejects.toBeInstanceOf(DeviceAuthenticationError);
  });

  it('rejects a signature from another device', async () => {
    const auth = new DeviceAuthService(new InMemoryDeviceAuthRepository(), secret);
    const owner = device();
    const attacker = device();
    const challenge = await auth.challenge(owner.publicSigner);
    const signature = Buffer.from(toDer(
      p256.sign(Buffer.from(challenge.challenge, 'base64'), attacker.privateKey, {prehash: false}),
    )).toString('base64');

    await expect(auth.createSession({
      challengeId: challenge.challengeId,
      publicSigner: owner.publicSigner,
      signature,
    })).rejects.toBeInstanceOf(DeviceAuthenticationError);
  });

  it('canonicalizes Android SPKI keys to the wallet contract signer point', async () => {
    const auth = new DeviceAuthService(new InMemoryDeviceAuthRepository(), secret);
    const key = device();
    const spki = Buffer.concat([Buffer.alloc(26, 0x30), Buffer.from(key.publicSigner, 'base64')]).toString('base64');
    const challenge = await auth.challenge(spki);
    const signature = Buffer.from(toDer(
      p256.sign(Buffer.from(challenge.challenge, 'base64'), key.privateKey, {prehash: false}),
    )).toString('base64');

    const session = await auth.createSession({challengeId: challenge.challengeId, publicSigner: spki, signature});

    expect(auth.verifySession(session.token)?.publicSigner).toBe(key.publicSigner);
  });

  it('rejects altered and expired session tokens', async () => {
    let now = new Date('2026-09-03T00:00:00.000Z');
    const auth = new DeviceAuthService(new InMemoryDeviceAuthRepository(), secret, () => now);
    const key = device();
    const challenge = await auth.challenge(key.publicSigner);
    const signature = Buffer.from(toDer(
      p256.sign(Buffer.from(challenge.challenge, 'base64'), key.privateKey, {prehash: false}),
    )).toString('base64');
    const session = await auth.createSession({challengeId: challenge.challengeId, publicSigner: key.publicSigner, signature});

    expect(auth.verifySession(`${session.token}x`)).toBeNull();
    now = new Date('2026-09-03T00:16:00.000Z');
    expect(auth.verifySession(session.token)).toBeNull();
  });
});
