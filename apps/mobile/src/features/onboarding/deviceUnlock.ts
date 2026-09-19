import {p256} from '@noble/curves/nist.js';
import {Buffer} from 'buffer';
import {derToCompactSignature, uncompressedPointFromSpki, SecureSignerError} from '@rosapay/secure-signer';
import {createNativeRosaPaySigner} from '../../native/nativeSigner';
import {createRandomBytes} from '../../shared/randomBytes';
import {hasSigningKey, KeyVaultError, loadSigningKey} from '../wallet/keyVault';
import {keypairFromSecret} from '../wallet/stellarKey';
import {useAppStore} from '../../state/appStore';

// An unlock challenge protects real money; it never falls back to weak randomness.
const randomBytes = createRandomBytes({allowInsecureFallback: false});

export type UnlockResult =
  | {ok: true}
  /**
   * There is no key left to unlock against — it was never created, or the
   * screen lock it was bound to changed and the platform destroyed it. Either
   * way retrying is pointless, so a caller must offer a way forward instead.
   */
  | {ok: false; reason: 'no-key'; message: string}
  | {ok: false; reason: 'refused'; message: string};

/**
 * Proves the device owner is present, against whichever key this account has.
 *
 * This is not a password check against a server — there is no server account.
 * It is the same guarantee that protects a payment, so it has to follow the
 * same key the payment would: an account created by this app pays from a smart
 * wallet whose only signer is the secure-element key, while the experimental
 * classic account pays from a secret in the Keychain. Unlocking against only
 * one of them locks out every owner who holds the other, and the way out of the
 * unlock screen erases the account.
 */
export async function unlockWithDevice(): Promise<UnlockResult> {
  const {smartWallet, wallet} = useAppStore.getState();
  if (smartWallet) return unlockWithSecureElement();
  if (wallet) return unlockWithVaultKey(wallet.address);
  return {ok: false, reason: 'no-key', message: 'There is no wallet key on this phone'};
}

/**
 * Has the hardware key sign a fresh random challenge and verifies it against
 * the key's own public point. A fresh challenge each time means a captured
 * signature proves nothing later.
 */
async function unlockWithSecureElement(): Promise<UnlockResult> {
  const signer = createNativeRosaPaySigner();
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
    // A key the screen lock destroyed is gone for good, however well the owner
    // proves who they are, so it is reported as absent rather than as refused.
    if (error instanceof SecureSignerError && error.code === 'KEY_INVALIDATED') {
      return {ok: false, reason: 'no-key', message: describe(error)};
    }
    return {ok: false, reason: 'refused', message: describe(error)};
  }
}

/**
 * Reads the classic account's secret back out of the Keychain, which the phone
 * only allows after confirming who is holding it, then checks it against the
 * address on screen. Passing the prompt only proves someone unlocked the phone;
 * matching the address proves the key still belongs to the wallet being shown.
 */
async function unlockWithVaultKey(address: string): Promise<UnlockResult> {
  if (!(await hasSigningKey())) {
    return {ok: false, reason: 'no-key', message: 'There is no wallet key on this phone'};
  }

  try {
    const keypair = keypairFromSecret(await loadSigningKey('Unlock Lumenade Pay'));
    if (keypair.publicKey() !== address) {
      return {
        ok: false,
        reason: 'no-key',
        message: 'The key on this phone does not match the wallet it shows',
      };
    }
    return {ok: true};
  } catch (error) {
    if (error instanceof KeyVaultError && error.code === 'MISSING') {
      return {ok: false, reason: 'no-key', message: error.message};
    }
    return {ok: false, reason: 'refused', message: describe(error)};
  }
}

function describe(error: unknown): string {
  if (error instanceof KeyVaultError) return error.message;
  if (error instanceof SecureSignerError) {
    switch (error.code) {
      case 'USER_CANCELLED':
        return 'Unlock was cancelled';
      case 'BIOMETRIC_FAILED':
        return 'The device could not confirm it was you';
      case 'LOCKED_OUT':
        return 'Too many attempts — unlock your phone first, then try again';
      case 'KEY_INVALIDATED':
        return 'Changing this phone’s screen lock destroyed the payment key';
      case 'UNAVAILABLE':
        return 'This device cannot unlock Lumenade Pay yet';
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : 'Unlock failed';
}
