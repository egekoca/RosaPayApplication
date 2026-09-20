import {derToCompactSignature, uncompressedPointFromSpki} from '@rosapay/secure-signer';
import {authorizeEntry, nativeToScVal, xdr} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';

/**
 * The two ways this wallet's signers are held, matching the contract's
 * `SignerKind`. They are not interchangeable: the contract verifies each by its
 * own rules and refuses a signature checked by the wrong ones.
 */
export type WalletSignerKind = 'device' | 'passkey';

export type HardwareDigestSigner = {
  /** The device's exported public key, SPKI or raw uncompressed point, base64. */
  publicKey: string;
  /** Asks the platform to prove user presence and sign the digest. */
  signDigest(request: {digest: string; reason: string}): Promise<{signature: string}>;
};

/**
 * A passkey does not sign what it is given.
 *
 * It signs `authenticatorData || SHA-256(clientDataJSON)`, having put the
 * challenge into that JSON itself. So the platform hands back three pieces and
 * all three have to reach the contract: without them it cannot check that the
 * genuine signature was made about *this* transaction.
 */
export type PasskeySigner = {
  /** The credential's public key, SPKI or raw uncompressed point, base64. */
  publicKey: string;
  assert(request: {challenge: string; reason: string}): Promise<{
    /** DER or compact, base64. */
    signature: string;
    /** Base64. */
    authenticatorData: string;
    /** Base64. */
    clientDataJSON: string;
  }>;
};

export type WalletSigner =
  | {kind: 'device'; signer: HardwareDigestSigner}
  | {kind: 'passkey'; signer: PasskeySigner};

function isHardwareDigestSigner(value: unknown): value is HardwareDigestSigner {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<HardwareDigestSigner>;
  return typeof candidate.publicKey === 'string' && typeof candidate.signDigest === 'function';
}

function isPasskeySigner(value: unknown): value is PasskeySigner {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PasskeySigner>;
  return typeof candidate.publicKey === 'string' && typeof candidate.assert === 'function';
}

function toBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/** Matches the contract's `DeviceSignature`, whose fields are ordered. */
export function deviceSignatureScVal(publicKey: Buffer, signature: Buffer): xdr.ScVal {
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

/** Matches the contract's `PasskeyAssertion`, whose fields are ordered. */
export function passkeyAssertionScVal(assertion: {
  publicKey: Buffer;
  signature: Buffer;
  authenticatorData: Buffer;
  clientDataJSON: Buffer;
}): xdr.ScVal {
  // Field order is the contract struct's declaration order, which the SDK
  // encodes as a map keyed by symbol.
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: nativeToScVal('authenticator_data', {type: 'symbol'}),
      val: xdr.ScVal.scvBytes(assertion.authenticatorData),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('client_data', {type: 'symbol'}),
      val: xdr.ScVal.scvBytes(assertion.clientDataJSON),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('public_key', {type: 'symbol'}),
      val: xdr.ScVal.scvBytes(assertion.publicKey),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('signature', {type: 'symbol'}),
      val: xdr.ScVal.scvBytes(assertion.signature),
    }),
  ]);
}

/** Wraps a variant in the contract's `WalletSignature` enum. */
export function walletSignatureScVal(kind: WalletSignerKind, value: xdr.ScVal): xdr.ScVal {
  return xdr.ScVal.scvVec([
    nativeToScVal(kind === 'device' ? 'Device' : 'Passkey', {type: 'symbol'}),
    value,
  ]);
}

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
  // Types stop a missing signer in source, but a persisted mobile state or a
  // stale bundle can still cross this boundary at runtime. Refuse it here with
  // evidence instead of dereferencing `undefined` as `signDigest` after the
  // customer has already pressed Approve.
  if (!isHardwareDigestSigner(signer)) {
    throw new Error('The device payment signer is missing or invalid. Reopen Rosa Pay and try again.');
  }

  const {signature} = await signer.signDigest({digest: payload.toString('base64'), reason});
  const compact = derToCompactSignature(Uint8Array.from(toBuffer(signature)));
  const point = uncompressedPointFromSpki(Uint8Array.from(toBuffer(signer.publicKey)));

  return walletSignatureScVal(
    'device',
    deviceSignatureScVal(Buffer.from(point), Buffer.from(compact)),
  );
}

/**
 * Asks a passkey to authorize this payload.
 *
 * The payload goes to the platform as the WebAuthn challenge, base64url without
 * padding, because that is the form it will appear in inside the client data
 * the contract reads back. Anything else and a genuine signature would be
 * rejected for being about the wrong thing.
 */
export async function assertWalletAuthPayload(
  signer: PasskeySigner,
  payload: Buffer,
  reason: string,
): Promise<xdr.ScVal> {
  if (payload.length !== 32) {
    throw new Error('A wallet authorization payload is exactly 32 bytes');
  }

  const assertion = await signer.assert({challenge: base64Url(payload), reason});
  const compact = derToCompactSignature(Uint8Array.from(toBuffer(assertion.signature)));
  const point = uncompressedPointFromSpki(Uint8Array.from(toBuffer(signer.publicKey)));

  return walletSignatureScVal(
    'passkey',
    passkeyAssertionScVal({
      publicKey: Buffer.from(point),
      signature: Buffer.from(compact),
      authenticatorData: toBuffer(assertion.authenticatorData),
      clientDataJSON: toBuffer(assertion.clientDataJSON),
    }),
  );
}

/** Base64url without padding, which is how WebAuthn carries a challenge. */
export function base64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type WalletAuthEntrySignerOptions = {
  /** Whichever kind of signer this phone holds for this wallet. */
  key: WalletSigner;
  networkPassphrase: string;
  /** Ledger after which the authorization can no longer be used. */
  validUntilLedger: number;
  reason?: string;
};

function requireWalletSigner(key: WalletSigner): WalletSigner {
  if (key?.kind === 'device' && isHardwareDigestSigner(key.signer)) return key;
  if (key?.kind === 'passkey' && isPasskeySigner(key.signer)) return key;
  throw new Error('The wallet payment signer is missing or invalid. Reopen Rosa Pay and try again.');
}

/**
 * Authorizes Soroban entries for a smart wallet. The generated client hands its
 * `signAuthEntry` callback a preimage, which only fits a classic account, so a
 * contract account has to supply the whole `authorizeEntry` step: the entry, its
 * preimage and the expiry are assembled here and the device only ever signs the
 * resulting digest.
 */
export function createWalletAuthorizeEntry(options: WalletAuthEntrySignerOptions) {
  // The discriminator and key travel together. Accepting both a bare signer
  // and this wrapper made the function guess which shape crossed the mobile
  // boundary; an object carrying its own `kind` could be mistaken for the
  // wrapper and lose the signer before authorization.
  const wallet = requireWalletSigner(options.key);
  return async (
    entry: xdr.SorobanAuthorizationEntry,
    _signer: unknown,
    validUntilLedger: number,
    networkPassphrase?: string,
  ): Promise<xdr.SorobanAuthorizationEntry> =>
    authorizeEntry(
      entry,
      async (_preimage, payload) => ({
        signatureScVal:
          wallet.kind === 'passkey'
            ? await assertWalletAuthPayload(
                wallet.signer,
                Buffer.from(payload),
                options.reason ?? 'Approve this payment',
              )
            : await signWalletAuthPayload(
                wallet.signer,
                Buffer.from(payload),
                options.reason ?? 'Approve this payment',
              ),
      }),
      options.validUntilLedger ?? validUntilLedger,
      networkPassphrase ?? options.networkPassphrase,
    );
}
