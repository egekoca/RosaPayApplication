import {freshLedgerFromRefetch, shouldListenInForeground} from '../src/app/navigation';

describe('foreground proximity route policy', () => {
  it('keeps the reader armed on every main tab', () => {
    expect(shouldListenInForeground('WalletTab', false)).toBe(true);
    expect(shouldListenInForeground('DashboardTab', false)).toBe(true);
    expect(shouldListenInForeground('ProfileTab', false)).toBe(true);
  });

  it('does not compete with Scan, Confirm or merchant HCE routes', () => {
    expect(shouldListenInForeground('Scan', false)).toBe(false);
    expect(shouldListenInForeground('Confirm', false)).toBe(false);
    expect(shouldListenInForeground('MerchantRequest', false)).toBe(false);
    expect(shouldListenInForeground('WalletTab', true)).toBe(false);
  });

  it('does not treat a stale cached ledger as live after a failed refresh', () => {
    expect(
      freshLedgerFromRefetch({data: {latestLedger: 1_500_000}, error: new Error('offline')}),
    ).toBeUndefined();
    expect(freshLedgerFromRefetch({data: undefined})).toBeUndefined();
    expect(freshLedgerFromRefetch({data: {latestLedger: 1_500_001}})).toBe(1_500_001);
  });
});
