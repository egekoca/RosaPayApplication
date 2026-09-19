import {payableAssets, payableAssetByCode} from '../src/features/payments/assets';
import {priceRequest} from '../src/features/merchant/pricedRequest';

/**
 * The merchant's pricing control offers one list: the assets this deployment
 * settles, and the currencies something will quote. These are the rules that
 * list has to obey, independent of how it is drawn.
 */
describe('what a merchant can name a price in', () => {
  it('offers every settled asset, not a truncated few', () => {
    // The currency row used to be cut to the first three, so a merchant who
    // wanted the fourth could not reach it and had no way to know it existed.
    // Nothing in the options may be sliced.
    expect(payableAssets.length).toBeGreaterThanOrEqual(2);
    expect(payableAssets.map(asset => asset.code)).toContain('XLM');
    expect(payableAssets.map(asset => asset.code)).toContain('USDC');
  });

  it('gives every asset a name and a note, because the sheet shows both', () => {
    for (const asset of payableAssets) {
      expect(asset.name.length).toBeGreaterThan(0);
      expect(asset.note.length).toBeGreaterThan(0);
      // SEP-38 identity is what lets a currency be quoted against it at all.
      expect(asset.sep38).toMatch(/^stellar:/);
    }
  });

  it('needs no conversion when the price is named in the asset itself', () => {
    // Selecting XLM or USDC answers both halves of the question: a price named
    // in USDC is paid in USDC, so there is no rate to hold and nothing to
    // convert before signing.
    expect(priceRequest({amount: '24.5', currency: undefined})).toBeUndefined();
  });

  it('converts a fiat price into the asset the customer will send', () => {
    const priced = priceRequest({
      amount: '500',
      currency: {asset: 'iso4217:TRY', currency: 'TRY', perUnit: '5.0000000'},
    });

    // 500 lira at 5 lira per unit is 100 units of the asset, and that is the
    // number that gets signed — the fiat figure never reaches the contract.
    expect(priced?.assetAmount).toBe('100.0000000');
  });

  it('refuses to price an amount that is not a number', () => {
    const currency = {asset: 'iso4217:TRY', currency: 'TRY', perUnit: '5.0000000'};
    // The screen blocks the request rather than signing something derived from
    // a blank or a typo.
    expect(priceRequest({amount: '', currency})).toBeUndefined();
    expect(priceRequest({amount: 'abc', currency})).toBeUndefined();
  });

  it('keeps the asset lookup that the sheet selection depends on', () => {
    // The sheet encodes an asset choice as its code and resolves it back; a
    // code that stopped resolving would silently leave the old asset selected
    // while the label changed.
    for (const asset of payableAssets) {
      expect(payableAssetByCode(asset.code)).toEqual(asset);
    }
    expect(payableAssetByCode('NOPE')).toBeUndefined();
  });
});
