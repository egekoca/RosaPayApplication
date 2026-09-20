import {shouldListenForProximity, shouldListenInForeground} from '../src/app/navigation';

describe('foreground proximity route policy', () => {
  it('keeps the listener armed on every main tab', () => {
    expect(shouldListenInForeground('WalletTab', false)).toBe(true);
    expect(shouldListenInForeground('DashboardTab', false)).toBe(true);
    expect(shouldListenInForeground('ProfileTab', false)).toBe(true);
  });

  it('does not compete with Scan, Confirm or the merchant request screen', () => {
    // Scan owns a reader session and MerchantRequest owns both outgoing radios.
    // Arming here as well would have one phone talking to itself.
    expect(shouldListenInForeground('Scan', false)).toBe(false);
    expect(shouldListenInForeground('Confirm', false)).toBe(false);
    expect(shouldListenInForeground('MerchantRequest', false)).toBe(false);
    expect(shouldListenInForeground('WalletTab', true)).toBe(false);
  });

  it('keeps Bluetooth listening on the camera screen, where NFC cannot', () => {
    /*
     * The two radios were armed by one flag, so Scan's exclusion — it owns an
     * NFC reader session and a second would have the phone talking to itself —
     * silently took Bluetooth down with it. Scan is exactly where a customer
     * who has just pressed Pay is standing, holding their phone up to the
     * merchant's, on the one screen that had switched the transport off.
     */
    expect(shouldListenInForeground('Scan', false)).toBe(false);
    expect(shouldListenForProximity('Scan', false)).toBe(true);
  });

  it('still leaves the screens that own a radio or are already paying', () => {
    // One is advertising its own request, the other is past the point of being
    // offered another.
    expect(shouldListenForProximity('MerchantRequest', false)).toBe(false);
    expect(shouldListenForProximity('Confirm', false)).toBe(false);
    expect(shouldListenForProximity('WalletTab', true)).toBe(false);
    expect(shouldListenForProximity('WalletTab', false)).toBe(true);
  });
});
