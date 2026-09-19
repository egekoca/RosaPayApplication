import {useQuery} from '@tanstack/react-query';
import {assetCodeOf, discoverAnchor, readIndicativePrices} from '@rosapay/anchor';

/** The anchor Lumenade Pay asks for a rate. Configurable, never hardcoded deeper. */
const PRICE_ANCHOR_DOMAIN = 'testanchor.stellar.org';

export type BalanceValue = {amount: string; currency: string};

/**
 * What a balance is worth in a currency people think in.
 *
 * The rate comes from an anchor's SEP-38 indicative prices, so it is a real
 * quote from a real Stellar service rather than a number this app invented. When
 * no anchor will quote, this returns nothing and the card shows no conversion —
 * a made-up value on a payment screen is worse than none.
 */
export function useBalanceValue(balance: string | undefined) {
  return useQuery({
    queryKey: ['balance-value', balance],
    enabled: Boolean(balance) && Number(balance) > 0,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<BalanceValue | null> => {
      const anchor = await discoverAnchor(PRICE_ANCHOR_DOMAIN);
      const prices = await readIndicativePrices({anchor, sellAmount: balance!});
      // Prefer a dollar quote, because that is the unit a stablecoin balance is
      // read in; otherwise take whatever the anchor offered first.
      const chosen = prices.find(price => assetCodeOf(price.asset) === 'USDC')
        ?? prices.find(price => assetCodeOf(price.asset) === 'USD')
        ?? prices[0];
      if (!chosen) return null;

      const value = Number(balance) * Number(chosen.price);
      if (!Number.isFinite(value)) return null;
      return {amount: value.toFixed(2), currency: assetCodeOf(chosen.asset)};
    },
  });
}
