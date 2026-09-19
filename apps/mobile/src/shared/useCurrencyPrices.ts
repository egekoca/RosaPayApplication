import {useQuery} from '@tanstack/react-query';
import {readCurrencyPrices, type CurrencyPrice} from '@rosapay/anchor';
import {resolveQuoteSource} from './priceSource';

/**
 * The currencies a merchant may name a price in.
 *
 * The list is the quote server's, not this screen's. A hardcoded row of flags
 * would offer a merchant a currency nothing can price, and they would find out
 * at the counter with a customer waiting.
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
      const source = await resolveQuoteSource(sellAsset);
      return readCurrencyPrices({source, ...(sellAsset ? {sellAsset} : {})});
    },
  });
}
