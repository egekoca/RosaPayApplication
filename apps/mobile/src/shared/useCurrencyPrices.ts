import {useQuery} from '@tanstack/react-query';
import {discoverAnchor, readCurrencyPrices, type CurrencyPrice} from '@rosapay/anchor';

/** The anchor Lumenade Pay asks for a rate. Configurable, never hardcoded deeper. */
const PRICE_ANCHOR_DOMAIN = 'testanchor.stellar.org';

/**
 * The currencies a merchant may name a price in.
 *
 * The list is the anchor's, not ours. A hardcoded row of flags would offer a
 * merchant a currency nothing on the network can price, and they would find out
 * at the counter with a customer waiting.
 */
export function useCurrencyPrices() {
  return useQuery({
    queryKey: ['currency-prices'],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<CurrencyPrice[]> => {
      const anchor = await discoverAnchor(PRICE_ANCHOR_DOMAIN);
      return readCurrencyPrices({anchor});
    },
  });
}
