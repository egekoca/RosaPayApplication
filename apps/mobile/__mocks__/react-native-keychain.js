/**
 * In-memory stand-in for the encrypted store, so tests exercise the session
 * persistence path without touching the platform Keychain/Keystore.
 */
let stored = null;

module.exports = {
  async getGenericPassword() {
    return stored ?? false;
  },
  async setGenericPassword(username, password) {
    stored = {username, password, service: 'com.rosapay.session'};
    return true;
  },
  async resetGenericPassword() {
    stored = null;
    return true;
  },
};
