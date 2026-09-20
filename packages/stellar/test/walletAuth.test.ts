import {p256} from '@noble/curves/nist.js';
import {Buffer} from 'buffer';
import {describe, expect, it, vi} from 'vitest';
import {Address, StrKey, scValToNative, xdr} from '@stellar/stellar-sdk';
import {
  assertWalletAuthPayload,
  base64Url,
  createWalletAuthorizeEntry,
  deviceSignatureScVal,
  passkeyAssertionScVal,
  signWalletAuthPayload,
} from '../src/walletAuth';
import {createHash} from 'node:crypto';

/** Platform keystores return ASN.1 DER, so the fake hardware signer does too. */
function toDer(compact: Uint8Array): Uint8Array {
  const encodeInteger = (value: Uint8Array) => {
    let bytes = value;
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
    const padded = (bytes[0] ?? 0) & 0x80 ? Uint8Array.from([0, ...bytes]) : bytes;
    return Uint8Array.from([0x02, padded.length, ...padded]);
  };
  const body = Uint8Array.from([
    ...encodeInteger(compact.subarray(0, 32)),
    ...encodeInteger(compact.subarray(32)),
  ]);
  return Uint8Array.from([0x30, body.length, ...body]);
}

function hardwareSigner(secretKey: Uint8Array) {
  const publicKey = p256.getPublicKey(secretKey, false);
  return {
    publicKey: Buffer.from(publicKey).toString('base64'),
    signDigest: vi.fn(async ({digest}: {digest: string}) => {
      const signature = p256.sign(Uint8Array.from(Buffer.from(digest, 'base64')), secretKey, {
        prehash: false,
        lowS: true,
      });
      return {signature: Buffer.from(toDer(signature)).toString('base64')};
    }),
  };
}

/**
 * A passkey never signs the payload it is handed. It builds a client-data
 * document around it and signs `authenticatorData || SHA-256(clientData)`, which
 * is exactly what this fake reproduces so the test exercises the real shape.
 */
function passkeySigner(secretKey: Uint8Array) {
  const publicKey = p256.getPublicKey(secretKey, false);
  const authenticatorData = Buffer.concat([
    Buffer.alloc(32, 0x49),
    Buffer.from([0x01 | 0x04 | 0x08 | 0x10]),
    Buffer.from([0, 0, 0, 1]),
  ]);
  return {
    publicKey: Buffer.from(publicKey).toString('base64'),
    assert: vi.fn(async ({challenge}: {challenge: string}) => {
      const clientDataJSON = Buffer.from(
        JSON.stringify({type: 'webauthn.get', challenge, origin: 'https://rosapay-mobile.vercel.app'}),
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
        signature: Buffer.from(toDer(signature)).toString('base64'),
        authenticatorData: authenticatorData.toString('base64'),
        clientDataJSON: clientDataJSON.toString('base64'),
      };
    }),
  };
}

describe('wallet authorization signing', () => {
  it('builds the signature value the wallet contract verifies', async () => {
    const secretKey = p256.utils.randomSecretKey();
    const signer = hardwareSigner(secretKey);
    const payload = Buffer.alloc(32, 3);

    const value = await signWalletAuthPayload(signer, payload, 'Approve this payment');
    const [variant, inner] = scValToNative(value) as [string, {public_key: Buffer; signature: Buffer}];
    expect(variant).toBe('Device');
    const native = inner;

    expect(signer.signDigest).toHaveBeenCalledWith({digest: payload.toString('base64'), reason: 'Approve this payment'});
    expect(native.public_key).toHaveLength(65);
    expect(native.signature).toHaveLength(64);
    expect(
      p256.verify(Uint8Array.from(native.signature), Uint8Array.from(payload), Uint8Array.from(native.public_key), {
        prehash: false,
      }),
    ).toBe(true);
  });

  it('refuses a payload that is not the 32-byte authorization digest', async () => {
    const signer = hardwareSigner(p256.utils.randomSecretKey());
    await expect(signWalletAuthPayload(signer, Buffer.alloc(31), 'x')).rejects.toThrow('exactly 32 bytes');
    expect(signer.signDigest).not.toHaveBeenCalled();
  });

  it('reports a missing device signer without dereferencing signDigest', async () => {
    await expect(
      signWalletAuthPayload(undefined as never, Buffer.alloc(32), 'Approve this payment'),
    ).rejects.toThrow('device payment signer is missing');
  });

  it('keeps the struct field order the contract expects', () => {
    expect(
      Object.keys(scValToNative(deviceSignatureScVal(Buffer.alloc(65, 4), Buffer.alloc(64, 5))) as object),
    ).toEqual(['public_key', 'signature']);
    expect(
      Object.keys(
        scValToNative(
          passkeyAssertionScVal({
            publicKey: Buffer.alloc(65, 4),
            signature: Buffer.alloc(64, 5),
            authenticatorData: Buffer.alloc(37, 6),
            clientDataJSON: Buffer.from('{}'),
          }),
        ) as object,
      ),
    ).toEqual(['authenticator_data', 'client_data', 'public_key', 'signature']);
  });

  it('hands a passkey the payload as a base64url challenge', async () => {
    const secretKey = p256.utils.randomSecretKey();
    const signer = passkeySigner(secretKey);
    const payload = Buffer.alloc(32, 7);

    const value = await assertWalletAuthPayload(signer, payload, 'Approve this payment');
    const [variant, assertion] = scValToNative(value) as [
      string,
      {public_key: Buffer; signature: Buffer; authenticator_data: Buffer; client_data: Buffer},
    ];

    expect(variant).toBe('Passkey');
    // The challenge has to arrive in the form the contract will look for, or a
    // genuine signature is rejected for being about the wrong thing.
    expect(signer.assert).toHaveBeenCalledWith({
      challenge: base64Url(payload),
      reason: 'Approve this payment',
    });
    expect(JSON.parse(assertion.client_data.toString()).challenge).toBe(base64Url(payload));
    expect(assertion.public_key).toHaveLength(65);
    expect(assertion.signature).toHaveLength(64);

    // And the signature really is over what WebAuthn says it is over.
    const signed = Buffer.concat([
      Buffer.from(assertion.authenticator_data),
      createHash('sha256').update(Buffer.from(assertion.client_data)).digest(),
    ]);
    expect(
      p256.verify(
        Uint8Array.from(assertion.signature),
        Uint8Array.from(createHash('sha256').update(signed).digest()),
        Uint8Array.from(assertion.public_key),
        {prehash: false},
      ),
    ).toBe(true);
  });

  it('base64url has no padding and none of the characters that need escaping', () => {
    // 32 bytes encode to 43 characters, and the last one carries only the two
    // leftover bits - which is why the all-ones case does not end in '_'.
    // Cross-checked against Node's own `base64url` encoder.
    expect(base64Url(Buffer.alloc(32, 0xff))).toBe(Buffer.alloc(32, 0xff).toString('base64url'));
    expect(base64Url(Buffer.alloc(32, 0xff))).toBe('_'.repeat(42) + '8');
    expect(base64Url(Buffer.alloc(32, 0))).toBe('A'.repeat(43));
    expect(base64Url(Buffer.alloc(32, 0xff))).toHaveLength(43);
  });

  it('refuses a passkey payload that is not the 32-byte digest', async () => {
    const signer = passkeySigner(p256.utils.randomSecretKey());
    await expect(assertWalletAuthPayload(signer, Buffer.alloc(31), 'x')).rejects.toThrow('exactly 32 bytes');
    expect(signer.assert).not.toHaveBeenCalled();
  });
});

describe('wallet authorization entries', () => {
  it('signs the entry itself rather than the preimage the classic path expects', async () => {
    const secretKey = p256.utils.randomSecretKey();
    const signer = hardwareSigner(secretKey);
    const authorize = createWalletAuthorizeEntry({
      key: {kind: 'device', signer},
      networkPassphrase: 'Test SDF Network ; September 2015',
      validUntilLedger: 1_000,
    });

    // A source-account entry needs no signature, so it comes back untouched and
    // proves the wrapper hands real entries to the SDK.
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(StrKey.encodeContract(Buffer.alloc(32, 5))).toScAddress(),
            functionName: 'settle_payment',
            args: [],
          }),
        ),
        subInvocations: [],
      }),
    });

    const authorized = await authorize(entry, undefined, 1_000);
    expect(authorized).toBeDefined();
    expect(signer.signDigest).not.toHaveBeenCalled();
  });

  it('keeps the device-key wrapper intact when the signer also has a kind field', async () => {
    const signer = Object.assign(hardwareSigner(p256.utils.randomSecretKey()), {kind: 'device-key'});
    const authorize = createWalletAuthorizeEntry({
      key: {kind: 'device', signer},
      networkPassphrase: 'Test SDF Network ; September 2015',
      validUntilLedger: 1_000,
    });
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(StrKey.encodeContract(Buffer.alloc(32, 7))).toScAddress(),
          nonce: xdr.Int64.fromString('42'),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(StrKey.encodeContract(Buffer.alloc(32, 5))).toScAddress(),
            functionName: 'settle_payment',
            args: [],
          }),
        ),
        subInvocations: [],
      }),
    });

    await authorize(entry, undefined, 1_000);

    expect(signer.signDigest).toHaveBeenCalledTimes(1);
  });
});
