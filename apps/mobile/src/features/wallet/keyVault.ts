import * as Keychain from 'react-native-keychain';
import {logger} from '../../shared/logger';

/**
 * The signing key lives in its own Keychain entry, not in the session blob.
 *
 * That separation is the whole design. `secureSessionStorage` is read on every
 * cold start so the app can show a balance, and an entry guarded by biometrics
 * cannot be read that way without prompting the owner for a fingerprint just to
 * open the app. Keeping the key apart lets the session stay ordinary and the key
 * stay behind the prompt, asked for only when something is about to be spent.
 */
const SERVICE = 'com.rosapay.signingkey';
const USERNAME = 'stellar-secret';

export class KeyVaultError extends Error {
  override readonly name = 'KeyVaultError';

  constructor(
    readonly code: 'NO_DEVICE_LOCK' | 'CANCELLED' | 'MISSING' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Biometrics where the device has them, the passcode where it does not. A key
 * bound to the *current* enrolled set means adding a new fingerprint to the
 * phone invalidates it, which is what stops someone who has the unlocked device
 * from enrolling their own finger and spending.
 */
const ACCESS_CONTROL = Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE;

/**
 * Whether this phone can hold the key at all.
 *
 * Android refuses to store an item behind user authentication when there is no
 * screen lock, and iOS behaves the same for a passcode-guarded item. That is
 * something the owner can go and fix, so it is worth asking before taking their
 * recovery phrase and failing afterwards.
 */
export async function canHoldSigningKey(): Promise<boolean> {
  try {
    const level = await Keychain.getSecurityLevel({accessControl: ACCESS_CONTROL});
    if (level === null) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Stores the secret behind the device owner.
 *
 * Nothing here logs the secret, and nothing returns it: the only way back out
 * is `loadSigningKey`, which prompts.
 */
export async function saveSigningKey(secret: string): Promise<void> {
  try {
    await Keychain.setGenericPassword(USERNAME, secret, {
      service: SERVICE,
      accessControl: ACCESS_CONTROL,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    // Storing unguarded instead would be the worst outcome: the wallet would
    // work, nobody would be told, and the key would sit readable on the device.
    logger.error('signing_key_store_failed', {message: describe(error)});
    throw new KeyVaultError(
      'NO_DEVICE_LOCK',
      'This phone needs a screen lock before it can hold a wallet key. Set one, then try again.',
    );
  }
}

/**
 * Asks the owner for the key. The prompt is the point — this is called at the
 * moment of paying, and `reason` is what the customer reads while deciding.
 */
export async function loadSigningKey(reason: string): Promise<string> {
  let stored: Awaited<ReturnType<typeof Keychain.getGenericPassword>>;
  try {
    stored = await Keychain.getGenericPassword({
      service: SERVICE,
      // The same access control the key was written under, repeated on the way
      // out. Without it the prompt asks for biometrics alone, so a phone with a
      // screen lock but no fingerprint enrolled — which is a great many of
      // them — is told "No fingerprints enrolled" and cannot reach its own
      // wallet at all. Naming it here is what allows the passcode fallback the
      // constant already promises.
      accessControl: ACCESS_CONTROL,
      authenticationPrompt: {title: reason, cancel: 'Cancel'},
    });
  } catch (error) {
    const detail = describe(error);
    if (/cancel/i.test(detail)) {
      throw new KeyVaultError('CANCELLED', 'You cancelled the device prompt, so nothing was signed.');
    }
    logger.error('signing_key_read_failed', {message: detail});
    throw new KeyVaultError('UNAVAILABLE', 'This phone could not unlock the wallet key.');
  }

  if (stored === false) {
    throw new KeyVaultError(
      'MISSING',
      'There is no wallet key on this phone. Restore your wallet with your recovery phrase.',
    );
  }
  return stored.password;
}

/** Whether a key is present, without asking the owner to prove they are them. */
export async function hasSigningKey(): Promise<boolean> {
  try {
    return (await Keychain.hasGenericPassword({service: SERVICE})) === true;
  } catch {
    return false;
  }
}

export async function clearSigningKey(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({service: SERVICE});
  } catch (error) {
    logger.error('signing_key_clear_failed', {message: describe(error)});
    throw new KeyVaultError('UNAVAILABLE', 'The wallet key could not be deleted from this phone.');
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown';
}
