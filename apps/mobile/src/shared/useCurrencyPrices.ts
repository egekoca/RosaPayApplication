import {useQuery} from '@tanstack/react-query';
import {assetCodeOf, readCurrencyPrices, type CurrencyPrice} from '@rosapay/anchor';
import {ownQuoteSource, readMarketIndicativePrices, resolveQuoteSource} from './priceSource';

/**
 * The currencies a merchant may name a price in.
 *
 * The list is the quote servers', not this screen's. A hardcoded row of flags
 * would offer a merchant a currency nothing can price, and they would find out
 * at the counter with a customer waiting.
 *
 * Both servers are asked and their answers merged, because between them they
 * know different things: the anchor prices lira and would actually exchange at
 * that rate, while the market feed covers every other currency and no anchor
 * at all. Asking only the anchor left a merchant pricing in USDC with lira as
 * their single option; asking only the feed would quote lira nobody has
 * committed to. The anchor wins where they overlap, since its number is the one
 * a ramp would honour.
 */
export function useCurrencyPrices(sellAsset?: string) {
  return useQuery({
    // The rate depends on what is being sold, so asking for lumens and then
    // pricing in USDC against it would quote the wrong amount.
    queryKey: ['currency-prices', sellAsset ?? 'native'],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<CurrencyPrice[]> => {
      const preferred = await resolveQuoteSource(sellAsset);
      const own = ownQuoteSource();
      const sources =
        preferred.quoteServer === own.quoteServer ? [own] : [preferred, own];

      const answers = await Promise.all(
        sources.map(source =>
          readCurrencyPrices({source, ...(sellAsset ? {sellAsset} : {})}).catch(() => []),
        ),
      );

      const byCurrency = new Map<string, CurrencyPrice>();
      for (const prices of answers) {
        for (const price of prices) {
          // First writer wins, and the anchor is asked first.
          if (!byCurrency.has(price.currency)) byCurrency.set(price.currency, price);
        }
      }

      // A hosted API image can advertise NGN/EUR in /info while its older
      // /prices handler still omits them. Fill only missing currencies from
      // the same public indicative feed used by the balance card; this is a
      // display/menu number, never a firm settlement quote.
      const fallback = await readMarketIndicativePrices(sellAsset ?? 'stellar:native').catch(() => []);
      for (const price of fallback) {
        const currency = assetCodeOf(price.asset);
        if (byCurrency.has(currency)) continue;
        const perUnit = Number(price.price);
        if (!Number.isFinite(perUnit) || perUnit <= 0) continue;
        byCurrency.set(currency, {
          currency,
          asset: price.asset,
          perUnit: (1 / perUnit).toFixed(10),
        });
      }
      return [...byCurrency.values()];
    },
  });
}
