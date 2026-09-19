import {derToCompactSignature, uncompressedPointFromSpki} from '@rosapay/secure-signer';
import {nativeToScVal, xdr} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';

export type HardwareDigestSigner = {
  /** The device's exported public key, SPKI or raw uncompressed point, base64. */
  publicKey: string;
  /** Asks the platform to prove user presence and sign the digest. */
  signDigest(request: {digest: string; reason: string}): Promise<{signature: string}>;
};

/**
 * Turns a platform keystore signature into the `WalletSignature` the Rosa smart
 * wallet verifies: the uncompressed public key plus a 64-byte low-S signature.
 * Every XDR detail stays here, so the platform module only ever sees a digest.
 */
export async function signWalletAuthPayload(
  signer: HardwareDigestSigner,
  payload: Buffer,
  reason: string,
): Promise<xdr.ScVal> {
  if (payload.length !== 32) {
    throw new Error('A wallet authorization payload is exactly 32 bytes');
  }

  const {signature} = await signer.signDigest({digest: payload.toString('base64'), reason});
  const compact = derToCompactSignature(Uint8Array.from(Buffer.from(signature, 'base64')));
  const point = uncompressedPointFromSpki(Uint8Array.from(Buffer.from(signer.publicKey, 'base64')));

  return walletSignatureScVal(Buffer.from(point), Buffer.from(compact));
}

/** Matches the contract's `WalletSignature` struct, whose fields are ordered. */
export function walletSignatureScVal(publicKey: Buffer, signature: Buffer): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: nativeToScVal('public_key', {type: 'symbol'}),
      val: xdr.ScVal.scvBytes(publicKey),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('signature', {type: 'symbol'}),
      val: xdr.ScVal.scvBytes(signature),
    }),
  ]);
}
