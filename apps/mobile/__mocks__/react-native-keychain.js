/**
 * In-memory stand-in for the encrypted store, so tests exercise the persistence
 * path without touching the platform Keychain/Keystore.
 *
 * Entries are keyed by service. The app keeps two — the session blob and the
 * wallet signing key, deliberately apart so the key can sit behind a biometric
 * prompt the session does not need — and a single shared slot would let one
 * quietly overwrite the other.
 */
const entries = new Map();

const DEFAULT_SERVICE = 'default';

/** Set by a test to make the next guarded write fail, as a lockless phone does. */
let deviceLock = true;

/** The options the last read asked with, so a test can assert the prompt terms. */
let lastReadOptions;

const ACCESS_CONTROL = {
  USER_PRESENCE: 'UserPresence',
  BIOMETRY_ANY: 'BiometryAny',
  BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
  DEVICE_PASSCODE: 'DevicePasscode',
  APPLICATION_PASSWORD: 'ApplicationPassword',
  BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
  BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE: 'BiometryCurrentSetOrDevicePasscode',
};

const ACCESSIBLE = {
  WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly',
};

const SECURITY_LEVEL = {ANY: 'ANY', SECURE_SOFTWARE: 'SECURE_SOFTWARE', SECURE_HARDWARE: 'SECURE_HARDWARE'};

function keyOf(options) {
  return (options && options.service) || DEFAULT_SERVICE;
}

module.exports = {
  ACCESS_CONTROL,
  ACCESSIBLE,
  SECURITY_LEVEL,

  async getGenericPassword(options) {
    lastReadOptions = options;
    return entries.get(keyOf(options)) ?? false;
  },
  async setGenericPassword(username, password, options) {
    if (options && options.accessControl && !deviceLock) {
      throw new Error('E_SECURITY_LEVEL: the device has no screen lock');
    }
    entries.set(keyOf(options), {username, password, service: keyOf(options)});
    return true;
  },
  async hasGenericPassword(options) {
    return entries.has(keyOf(options));
  },
  async resetGenericPassword(options) {
    entries.delete(keyOf(options));
    return true;
  },
  async getSecurityLevel() {
    return deviceLock ? SECURITY_LEVEL.SECURE_HARDWARE : null;
  },
  async getSupportedBiometryType() {
    return deviceLock ? 'FaceID' : null;
  },

  /** Test hooks, not part of the real module. */
  __setDeviceLock(present) {
    deviceLock = present;
  },
  __lastReadOptions() {
    return lastReadOptions;
  },
  __reset() {
    entries.clear();
    deviceLock = true;
    lastReadOptions = undefined;
  },
};
