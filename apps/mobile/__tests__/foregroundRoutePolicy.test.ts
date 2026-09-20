import {shouldListenInForeground} from '../src/app/navigation';

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
});
