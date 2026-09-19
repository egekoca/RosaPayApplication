import {freshLedgerFromRefetch, shouldListenForForegroundNfc} from '../src/app/navigation';

describe('foreground NFC route policy', () => {
  it('keeps the reader armed on every main tab', () => {
    expect(shouldListenForForegroundNfc('WalletTab', false)).toBe(true);
    expect(shouldListenForForegroundNfc('DashboardTab', false)).toBe(true);
    expect(shouldListenForForegroundNfc('ProfileTab', false)).toBe(true);
  });

  it('does not compete with Scan, Confirm or merchant HCE routes', () => {
    expect(shouldListenForForegroundNfc('Scan', false)).toBe(false);
    expect(shouldListenForForegroundNfc('Confirm', false)).toBe(false);
    expect(shouldListenForForegroundNfc('MerchantRequest', false)).toBe(false);
    expect(shouldListenForForegroundNfc('WalletTab', true)).toBe(false);
  });

  it('does not treat a stale cached ledger as live after a failed refresh', () => {
    expect(
      freshLedgerFromRefetch({data: {latestLedger: 1_500_000}, error: new Error('offline')}),
    ).toBeUndefined();
    expect(freshLedgerFromRefetch({data: undefined})).toBeUndefined();
    expect(freshLedgerFromRefetch({data: {latestLedger: 1_500_001}})).toBe(1_500_001);
  });
});
