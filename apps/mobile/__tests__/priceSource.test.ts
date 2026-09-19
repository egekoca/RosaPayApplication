import {readMarketIndicativePrices} from '../src/shared/priceSource';

describe('market display fallback', () => {
  it('converts CoinGecko fiat-per-asset values into SEP-38 direction', async () => {
    const fetcher = jest.fn(async () =>
      new Response(JSON.stringify({stellar: {try: 8.46, ngn: 230.5, eur: 0.150757}}), {status: 200}),
    ) as unknown as typeof fetch;

    await expect(readMarketIndicativePrices('stellar:native', fetcher)).resolves.toEqual([
      {asset: 'iso4217:TRY', price: '0.1182033097', decimals: 2},
      {asset: 'iso4217:NGN', price: '0.0043383948', decimals: 2},
      {asset: 'iso4217:EUR', price: '6.6331911619', decimals: 2},
    ]);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('vs_currencies=try%2Cusd%2Cngn%2Ceur'));
  });
});
