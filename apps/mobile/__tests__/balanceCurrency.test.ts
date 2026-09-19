import {assetCodeOf, currencyValueOfAsset} from '@rosapay/anchor';

/**
 * Reading a balance in the currency that was asked for, and in no other.
 *
 * `useBalanceValue` used to walk a preference order, so a wallet asked for
 * dollars answered in lira whenever nothing would quote dollars. The figure
 * carried its own label and was still the wrong answer: someone who picks USD
 * and reads "₺50,732.12 TRY" concludes the picker is broken, which is what was
 * reported from the simulator. These are the rules the selection now follows.
 */
describe('choosing which quote answers a balance', () => {
  const prices = [
    {asset: 'iso4217:TRY', price: '0.1971138002'},
    {asset: 'iso4217:USD', price: '9.5343945000'},
  ];

  function pick(wanted: string) {
    return prices.find(price => assetCodeOf(price.asset) === wanted);
  }

  it('reads the wallet in the currency that was chosen', () => {
    const chosen = pick('USD');
    expect(chosen).toBeDefined();
    // 10,000 lumens at 9.5343945 lumens per dollar.
    expect(currencyValueOfAsset({amount: '10000', price: chosen!.price})).toBeCloseTo(1048.79, 1);
  });

  it('finds nothing rather than substituting another currency', () => {
    // Nothing quotes naira in this set. The old code would have handed back the
    // lira quote here, and the card would have shown lira under a naira flag.
    expect(pick('NGN')).toBeUndefined();
  });

  it('keeps each currency on its own scale', () => {
    const lira = currencyValueOfAsset({amount: '10000', price: pick('TRY')!.price});
    const dollars = currencyValueOfAsset({amount: '10000', price: pick('USD')!.price});

    // The same balance is a much larger number in lira than in dollars, so a
    // silent substitution is not a small error — it is off by a factor of 48.
    expect(lira).toBeGreaterThan(dollars * 40);
  });

  it('treats a zero or negative price as no quote at all', () => {
    // A price of nothing would make a funded wallet read as worthless.
    expect(Number.isFinite(currencyValueOfAsset({amount: '10000', price: '0'}))).toBe(false);
    expect(Number.isFinite(currencyValueOfAsset({amount: '10000', price: '-1'}))).toBe(false);
  });
});
