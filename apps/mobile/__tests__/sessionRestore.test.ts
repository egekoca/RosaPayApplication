import {hasRestorableSession} from '../src/state/appStore';

describe('session restoration', () => {
  it('treats a wallet, a business profile or past receipts as a session to return to', () => {
    expect(hasRestorableSession({customerWallet: null, merchantProfile: null, receipts: []})).toBe(false);
    expect(
      hasRestorableSession({
        customerWallet: {publicKey: 'GABC', seed: new Uint8Array(32), funded: true},
        merchantProfile: null,
        receipts: [],
      }),
    ).toBe(true);
    expect(
      hasRestorableSession({
        customerWallet: null,
        merchantProfile: null,
        receipts: [{intentId: 'a'} as never],
      }),
    ).toBe(true);
  });
});
