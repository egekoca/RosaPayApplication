import {p256} from '@noble/curves/nist.js';
import {Buffer} from 'buffer';
import {describe, expect, it, vi} from 'vitest';
import {scValToNative} from '@stellar/stellar-sdk';
import {signWalletAuthPayload, walletSignatureScVal} from '../src/walletAuth';

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
