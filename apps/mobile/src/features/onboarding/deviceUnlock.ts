import {p256} from '@noble/curves/nist.js';
import {Buffer} from 'buffer';
import {derToCompactSignature, uncompressedPointFromSpki, SecureSignerError} from '@rosapay/secure-signer';
import {createNativeRosaPaySigner} from '../../native/nativeSigner';
import {createRandomBytes} from '../../shared/randomBytes';

const signer = createNativeRosaPaySigner();
// An unlock challenge protects real money; it never falls back to weak randomness.
const randomBytes = createRandomBytes({allowInsecureFallback: false});

export type UnlockResult =
  | {ok: true}
  /** The device has no payment key yet, so there is nothing to unlock against. */
  | {ok: false; reason: 'no-key'; message: string}
  | {ok: false; reason: 'refused'; message: string};

/**
 * Proves the device owner is present, by having the hardware key sign a fresh
 * random challenge and verifying the signature against the key's public point.
 *
 * This is not a password check against a server — there is no server account.
 * It is the same guarantee that protects a payment: the private key lives in the
 * Secure Enclave or the Android Keystore and will not sign without the user.
 * A fresh challenge each time means a captured signature proves nothing later.
 */
export async function unlockWithDevice(): Promise<UnlockResult> {
  let identity;
  try {
    identity = await signer.getIdentity();
  } catch (error) {
    return {ok: false, reason: 'refused', message: describe(error)};
  }

  if (!identity?.publicKey) {
    return {ok: false, reason: 'no-key', message: 'This device has no payment key yet'};
  }

  const challenge = randomBytes(32);
  try {
    const signed = await signer.signDigest({
      digest: Buffer.from(challenge).toString('base64'),
      reason: 'Unlock Lumenade Pay',
    });
    const signature = derToCompactSignature(Uint8Array.from(Buffer.from(signed.signature, 'base64')));
    const point = uncompressedPointFromSpki(Uint8Array.from(Buffer.from(identity.publicKey, 'base64')));
    if (!p256.verify(signature, challenge, point, {prehash: false})) {
      return {ok: false, reason: 'refused', message: 'The device produced a signature that does not verify'};
    }
    return {ok: true};
  } catch (error) {
    return {ok: false, reason: 'refused', message: describe(error)};
  }
}

function describe(error: unknown): string {
  if (error instanceof SecureSignerError) {
    switch (error.code) {
      case 'USER_CANCELLED':
        return 'Unlock was cancelled';
      case 'BIOMETRIC_FAILED':
        return 'The device could not confirm it was you';
      case 'LOCKED_OUT':
        return 'Too many attempts — unlock your phone first, then try again';
      case 'UNAVAILABLE':
        return 'This device cannot unlock Lumenade Pay yet';
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : 'Unlock failed';
}
