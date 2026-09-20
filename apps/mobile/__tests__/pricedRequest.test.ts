import {priceRequest, referenceForRequest} from '../src/features/merchant/pricedRequest';

const lira = {currency: 'TRY', asset: 'iso4217:TRY', perUnit: '13.4'};

describe('pricing a request in the money on the menu', () => {
  it('converts the price into the amount the contract will move', () => {
    expect(priceRequest({amount: '500', currency: lira})).toEqual({
      assetAmount: '37.3134329',
      label: '500.00 TRY',
    });
  });

  it('stays silent until there is a price to convert', () => {
    expect(priceRequest({amount: '', currency: lira})).toBeUndefined();
    expect(priceRequest({amount: '   ', currency: lira})).toBeUndefined();
  });

  it('leaves the amount alone when the merchant prices in the asset itself', () => {
    expect(priceRequest({amount: '24.5', currency: undefined})).toBeUndefined();
  });

  it('shows nothing rather than a wrong amount when the price makes no sense', () => {
    expect(priceRequest({amount: 'two coffees', currency: lira})).toBeUndefined();
    expect(priceRequest({amount: '500', currency: {...lira, perUnit: '0'}})).toBeUndefined();
  });

  it('tells the customer the price they were quoted, beside the merchant’s own note', () => {
    const priced = priceRequest({amount: '500', currency: lira});
    expect(referenceForRequest('Table 08', priced, '24.5 XLM')).toBe('Table 08 · 500.00 TRY');
  });

  it('still names the price when the merchant wrote no note', () => {
    const priced = priceRequest({amount: '500', currency: lira});
    expect(referenceForRequest('', priced, '24.5 XLM')).toBe('500.00 TRY');
  });

  it('leaves the reference untouched when nothing was converted', () => {
    expect(referenceForRequest('Table 08', undefined, '24.5 XLM')).toBe('Table 08');
  });

  it('names the amount when a merchant types nothing at all', () => {
    // The field is optional, and most counters have nothing to say beyond the
    // amount. RTP/1 still signs and shows this field, so it must not be empty —
    // and the honest thing to put there is what is being asked for.
    expect(referenceForRequest('', undefined, '24.5 XLM')).toBe('24.5 XLM');
    expect(referenceForRequest('   ', undefined, ' 24.5 XLM ')).toBe('24.5 XLM');
  });
});
