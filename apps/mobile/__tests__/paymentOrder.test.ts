import {MERCHANT_PAGE_SIZE, orderMerchantPayments} from '../src/features/merchant/paymentOrder';

const at = (intentId: string, status: string, createdAt: string) => ({intentId, status, createdAt});

describe('the order a counter reads its requests in', () => {
  it('puts the live requests above everything that is already over', () => {
    /*
     * Newest-first alone buries the request the merchant is standing over: a
     * busy day puts this morning's paid coffees above the code on the counter
     * right now, and the one row still doing something scrolls away.
     */
    const ordered = orderMerchantPayments([
      at('paid-today', 'confirmed', '2026-09-19T12:00:00.000Z'),
      at('open-older', 'awaiting_approval', '2026-09-19T09:00:00.000Z'),
      at('expired', 'expired', '2026-09-19T11:00:00.000Z'),
    ]);

    expect(ordered.map(payment => payment.intentId)).toEqual(['open-older', 'paid-today', 'expired']);
  });

  it('reads newest first inside each group', () => {
    const ordered = orderMerchantPayments([
      at('open-old', 'awaiting_approval', '2026-09-19T08:00:00.000Z'),
      at('open-new', 'created', '2026-09-19T10:00:00.000Z'),
      at('done-old', 'confirmed', '2026-09-18T08:00:00.000Z'),
      at('done-new', 'confirmed', '2026-09-19T07:00:00.000Z'),
    ]);

    expect(ordered.map(payment => payment.intentId)).toEqual([
      'open-new',
      'open-old',
      'done-new',
      'done-old',
    ]);
  });

  it('keeps finished requests rather than hiding them', () => {
    // A merchant checking whether a payment landed is looking for a row that is
    // finished; a list of only live requests has nowhere for that question.
    const ordered = orderMerchantPayments([at('done', 'confirmed', '2026-09-19T08:00:00.000Z')]);
    expect(ordered).toHaveLength(1);
  });

  it('sorts a date it cannot read to the end instead of scrambling the list', () => {
    // `NaN` compares false against everything, so an unparseable date silently
    // disorders a sort rather than failing it.
    const ordered = orderMerchantPayments([
      at('broken', 'confirmed', 'not a date'),
      at('real', 'confirmed', '2026-09-19T08:00:00.000Z'),
    ]);
    expect(ordered.map(payment => payment.intentId)).toEqual(['real', 'broken']);
  });

  it('leaves the original list alone', () => {
    const payments = [
      at('a', 'confirmed', '2026-09-18T08:00:00.000Z'),
      at('b', 'awaiting_approval', '2026-09-19T08:00:00.000Z'),
    ];
    orderMerchantPayments(payments);
    expect(payments.map(payment => payment.intentId)).toEqual(['a', 'b']);
  });

  it('shows enough rows to be worth scrolling', () => {
    expect(MERCHANT_PAGE_SIZE).toBeGreaterThanOrEqual(5);
  });
});
