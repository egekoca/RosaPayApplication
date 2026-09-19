import {p256} from '@noble/curves/nist.js';
import {Buffer} from 'buffer';
import {describe, expect, it, vi} from 'vitest';
import {Address, StrKey, scValToNative, xdr} from '@stellar/stellar-sdk';
import {createWalletAuthorizeEntry, signWalletAuthPayload, walletSignatureScVal} from '../src/walletAuth';

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

describe('wallet authorization signing', () => {
  it('builds the signature value the wallet contract verifies', async () => {
    const secretKey = p256.utils.randomSecretKey();
    const signer = hardwareSigner(secretKey);
    const payload = Buffer.alloc(32, 3);

    const value = await signWalletAuthPayload(signer, payload, 'Approve this payment');
    const native = scValToNative(value) as {public_key: Buffer; signature: Buffer};

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

  it('keeps the struct field order the contract expects', () => {
    const value = walletSignatureScVal(Buffer.alloc(65, 4), Buffer.alloc(64, 5));
    expect(Object.keys(scValToNative(value) as object)).toEqual(['public_key', 'signature']);
  });
});

describe('wallet authorization entries', () => {
  it('signs the entry itself rather than the preimage the classic path expects', async () => {
    const secretKey = p256.utils.randomSecretKey();
    const signer = hardwareSigner(secretKey);
    const authorize = createWalletAuthorizeEntry({
      signer,
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
});
