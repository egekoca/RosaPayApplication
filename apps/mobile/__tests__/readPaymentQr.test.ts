import {encodePaymentQr} from '@rosapay/protocol';
import {readPaymentQr} from '../src/features/payments/readPaymentQr';
import {mockSignedIntent} from '../src/features/payments/mockIntent';

const context = {network: 'testnet' as const, latestLedger: 1_500_000, maxLedgerLifetime: 1_440};

describe('readPaymentQr', () => {
  it('accepts a merchant-signed request', () => {
    const result = readPaymentQr(encodePaymentQr(mockSignedIntent), context);
    expect(result).toEqual({ok: true, payload: mockSignedIntent});
  });

  it('reports anything that is not a Lumenade Pay request', () => {
    const result = readPaymentQr('https://example.com/menu', context);
    expect(result).toEqual({ok: false, message: 'Unsupported payment QR'});
  });

  it('refuses a code too large to be a payment request', () => {
    const result = readPaymentQr(`rosapay://pay/${'A'.repeat(5_000)}`, context);
    expect(result).toMatchObject({ok: false, message: expect.stringMatching(/too large/)});
  });

  it('refuses a request whose merchant signature does not match', () => {
    const forged = encodePaymentQr({
      ...mockSignedIntent,
      intent: {...mockSignedIntent.intent, amount: '2450.5'},
    });
    expect(readPaymentQr(forged, context)).toEqual({
      ok: false,
      message: 'This request was not signed by the merchant it names',
    });
  });

  it('refuses a request the ledger has already passed', () => {
    const result = readPaymentQr(encodePaymentQr(mockSignedIntent), {
      ...context,
      latestLedger: mockSignedIntent.intent.expiresAtLedger + 1,
    });
    expect(result.ok).toBe(false);
  });
});
