import * as Keychain from 'react-native-keychain';
import {
  canHoldSigningKey,
  clearSigningKey,
  hasSigningKey,
  KeyVaultError,
  loadSigningKey,
  saveSigningKey,
} from '../src/features/wallet/keyVault';

const keychain = Keychain as unknown as {
  __reset(): void;
  __setDeviceLock(present: boolean): void;
  getGenericPassword(options?: {service?: string}): Promise<false | {password: string}>;
};

const SECRET = 'SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN';

beforeEach(() => keychain.__reset());

describe('where the wallet key is kept', () => {
  it('stores and returns it behind the device owner', async () => {
    await saveSigningKey(SECRET);
    expect(await hasSigningKey()).toBe(true);
    expect(await loadSigningKey('Approve this payment')).toBe(SECRET);
  });

  it('keeps the key out of the session blob the app reads on every start', async () => {
    await saveSigningKey(SECRET);
    // The session store writes under its own service and must not see the key,
    // or opening the app would hand it out with no prompt at all.
    const session = await keychain.getGenericPassword({service: 'com.rosapay.session'});
    expect(session).toBe(false);
  });

  it('refuses a phone with no screen lock instead of storing the key unguarded', async () => {
    keychain.__setDeviceLock(false);
    expect(await canHoldSigningKey()).toBe(false);
    await expect(saveSigningKey(SECRET)).rejects.toMatchObject({code: 'NO_DEVICE_LOCK'});
    expect(await hasSigningKey()).toBe(false);
  });

  it('says so plainly when there is no key to sign with', async () => {
    await expect(loadSigningKey('Approve this payment')).rejects.toBeInstanceOf(KeyVaultError);
    await expect(loadSigningKey('Approve this payment')).rejects.toMatchObject({code: 'MISSING'});
  });

  it('is gone after signing out', async () => {
    await saveSigningKey(SECRET);
    await clearSigningKey();
    expect(await hasSigningKey()).toBe(false);
    await expect(loadSigningKey('Approve this payment')).rejects.toMatchObject({code: 'MISSING'});
  });
});
