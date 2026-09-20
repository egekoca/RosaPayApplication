import {shouldListenForProximity} from '../src/app/navigation';

describe('foreground proximity route policy', () => {
  it('keeps the listener armed on every main tab', () => {
    expect(shouldListenForProximity('WalletTab', false)).toBe(true);
    expect(shouldListenForProximity('DashboardTab', false)).toBe(true);
    expect(shouldListenForProximity('ProfileTab', false)).toBe(true);
  });

  it('listens on the camera screen, which is where a customer stands', () => {
    /*
     * Scan used to be excluded because it owned an NFC reader session and a
     * second would have had the phone talking to itself. There is no reader
     * any more, and Scan is exactly where a customer who has just pressed Pay
     * is standing, holding their phone up to the merchant's.
     */
    expect(shouldListenForProximity('Scan', false)).toBe(true);
  });

  it('leaves the screens that own the radio or are already paying', () => {
    // One is advertising its own request, the other is past the point of being
    // offered another.
    expect(shouldListenForProximity('MerchantRequest', false)).toBe(false);
    expect(shouldListenForProximity('Confirm', false)).toBe(false);
  });

  it('hears nothing behind a lock screen', () => {
    expect(shouldListenForProximity('WalletTab', true)).toBe(false);
    expect(shouldListenForProximity('Scan', true)).toBe(false);
  });
});
