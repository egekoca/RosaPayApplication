import {createHash} from 'node:crypto';
import {p256} from '@noble/curves/nist.js';
import {
  PasskeyError,
  createPasskey,
  createPasskeySigner,
  passkeysAvailable,
  type PasskeyNativeModule,
} from '../src/features/wallet/passkey';

/** Minimal CBOR writer, so the attestation fixtures are built rather than pasted. */
function head(major: number, argument: number): number[] {
  if (argument < 24) return [(major << 5) | argument];
  if (argument < 0x100) return [(major << 5) | 24, argument];
  return [(major << 5) | 25, argument >> 8, argument & 0xff];
}
const bytes = (value: Uint8Array) => [...head(2, value.length), ...value];
const text = (value: string) => [...head(3, value.length), ...Buffer.from(value)];
const unsigned = (value: number) => head(0, value);
const negative = (value: number) => head(1, -1 - value);

function attestationFor(publicKey: Uint8Array, credentialId: Uint8Array): Buffer {
  const cose = [
    ...head(5, 5),
    ...unsigned(1),
    ...unsigned(2),
    ...unsigned(3),
    ...negative(-7),
    ...negative(-1),
    ...unsigned(1),
    ...negative(-2),
    ...bytes(publicKey.subarray(1, 33)),
    ...negative(-3),
    ...bytes(publicKey.subarray(33)),
  ];
  const authData = Uint8Array.from([
    ...new Uint8Array(32).fill(0x49),
    0x40 | 0x01 | 0x04,
    0,
    0,
    0,
    1,
    ...new Uint8Array(16),
    (credentialId.length >> 8) & 0xff,
    credentialId.length & 0xff,
    ...credentialId,
    ...cose,
  ]);
  return Buffer.from(
    Uint8Array.from([...head(5, 1), ...text('authData'), ...bytes(authData)]),
  );
}

const base64Url = (value: Uint8Array | Buffer) => Buffer.from(value).toString('base64url');

function fakePlatform(secretKey = p256.utils.randomSecretKey()) {
  const publicKey = p256.getPublicKey(secretKey, false);
  const credentialId = new Uint8Array(20).fill(3);
  const authenticatorData = Buffer.concat([
    Buffer.alloc(32, 0x49),
    Buffer.from([0x01 | 0x04 | 0x08 | 0x10]),
    Buffer.from([0, 0, 0, 1]),
  ]);

  const module: PasskeyNativeModule & {lastChallenge?: string} = {
    isSupported: async () => true,
    createCredential: async () => ({
      credentialId: base64Url(credentialId),
      attestationObject: base64Url(attestationFor(publicKey, credentialId)),
      clientDataJSON: base64Url(Buffer.from('{"type":"webauthn.create"}')),
    }),
    assert: async ({challenge}) => {
      module.lastChallenge = challenge;
      const clientDataJSON = Buffer.from(
        JSON.stringify({type: 'webauthn.get', challenge, origin: 'https://lumenade-pay.vercel.app'}),
      );
      const signed = Buffer.concat([
        authenticatorData,
        createHash('sha256').update(clientDataJSON).digest(),
      ]);
      const signature = p256.sign(createHash('sha256').update(signed).digest(), secretKey, {
        prehash: false,
        lowS: true,
      });
      return {
        credentialId: base64Url(credentialId),
        authenticatorData: base64Url(authenticatorData),
        clientDataJSON: base64Url(clientDataJSON),
        signature: base64Url(Buffer.from(signature)),
      };
    },
  };
  return {module, publicKey, credentialId, secretKey, authenticatorData};
}

describe('creating a passkey', () => {
  it('reads the public key the wallet will register', async () => {
    const platform = fakePlatform();
    const credential = await createPasskey({userId: new Uint8Array(16).fill(1)}, platform.module);

    expect(Buffer.from(credential.publicKey, 'base64')).toEqual(Buffer.from(platform.publicKey));
    expect(credential.credentialId).toBe(base64Url(platform.credentialId));
  });

  it('uses a fresh challenge every time, because a reused one is replayable', async () => {
    const platform = fakePlatform();
    const seen: string[] = [];
    const module = {
      ...platform.module,
      createCredential: async (request: {challenge: string}) => {
        seen.push(request.challenge);
        return platform.module.createCredential(request as never);
      },
    } as PasskeyNativeModule;

    await createPasskey({userId: new Uint8Array(16)}, module);
    await createPasskey({userId: new Uint8Array(16)}, module);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(Buffer.from(seen[0]!, 'base64url')).toHaveLength(32);
  });

  it('refuses a response whose two credential ids disagree', async () => {
    const platform = fakePlatform();
    const module: PasskeyNativeModule = {
      ...platform.module,
      createCredential: async request => ({
        ...(await platform.module.createCredential(request)),
        credentialId: base64Url(new Uint8Array(20).fill(9)),
      }),
    };
    await expect(createPasskey({userId: new Uint8Array(16)}, module)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('reports a dismissed prompt as a cancellation rather than a failure', async () => {
    const platform = fakePlatform();
    const module: PasskeyNativeModule = {
      ...platform.module,
      createCredential: async () => {
        throw Object.assign(new Error('user cancelled'), {code: 'USER_CANCELLED'});
      },
    };
    await expect(createPasskey({userId: new Uint8Array(16)}, module)).rejects.toMatchObject({
      code: 'USER_CANCELLED',
    });
  });

  it('refuses to pretend a build without the module can hold a passkey', async () => {
    await expect(createPasskey({userId: new Uint8Array(16)}, undefined)).rejects.toBeInstanceOf(PasskeyError);
    expect(await passkeysAvailable(undefined)).toBe(false);
  });
});

describe('signing with a passkey', () => {
  it('hands the platform the payload as a base64url challenge', async () => {
    const platform = fakePlatform();
    const credential = await createPasskey({userId: new Uint8Array(16)}, platform.module);
    const signer = createPasskeySigner(credential, {}, platform.module);

    const payload = Buffer.alloc(32, 7);
    await signer.assert({challenge: payload.toString('base64url'), reason: 'Approve'});

    expect(platform.module.lastChallenge).toBe(payload.toString('base64url'));
  });

  it('returns an assertion that verifies the way the contract will check it', async () => {
    const platform = fakePlatform();
    const credential = await createPasskey({userId: new Uint8Array(16)}, platform.module);
    const signer = createPasskeySigner(credential, {}, platform.module);

    const payload = Buffer.alloc(32, 11);
    const assertion = await signer.assert({
      challenge: payload.toString('base64url'),
      reason: 'Approve',
    });

    const authenticatorData = Buffer.from(assertion.authenticatorData, 'base64');
    const clientDataJSON = Buffer.from(assertion.clientDataJSON, 'base64');

    // The challenge the contract will read out has to be this payload.
    expect(JSON.parse(clientDataJSON.toString()).challenge).toBe(payload.toString('base64url'));

    // And the signature has to be over authenticatorData || SHA-256(clientData).
    const signed = Buffer.concat([
      authenticatorData,
      createHash('sha256').update(clientDataJSON).digest(),
    ]);
    expect(
      p256.verify(
        Uint8Array.from(Buffer.from(assertion.signature, 'base64')),
        Uint8Array.from(createHash('sha256').update(signed).digest()),
        Uint8Array.from(Buffer.from(credential.publicKey, 'base64')),
        {prehash: false},
      ),
    ).toBe(true);
  });

  it('scopes the assertion to this wallet’s own credential', async () => {
    const platform = fakePlatform();
    const credential = await createPasskey({userId: new Uint8Array(16)}, platform.module);
    let scopedTo: string | undefined;
    const module: PasskeyNativeModule = {
      ...platform.module,
      assert: async request => {
        scopedTo = request.credentialId;
        return platform.module.assert(request);
      },
    };

    await createPasskeySigner(credential, {}, module).assert({
      challenge: Buffer.alloc(32).toString('base64url'),
      reason: 'Approve',
    });
    expect(scopedTo).toBe(credential.credentialId);
  });
});
