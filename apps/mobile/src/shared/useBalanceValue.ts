import {useQuery} from '@tanstack/react-query';
import {assetCodeOf, discoverAnchor, readIndicativePrices} from '@rosapay/anchor';
import {payableAssetByCode} from '../features/payments/assets';
import type {Holding} from './useWalletBalance';
import {displayAmount} from './displayAmount';

/** The anchor Lumenade Pay asks for a rate. Configurable, never hardcoded deeper. */
const PRICE_ANCHOR_DOMAIN = 'testanchor.stellar.org';

export type BalanceValue = {amount: string; currency: string};

/** The unit a mixed balance is worth reading in. */
const PREFERRED = ['USDC', 'USD'];

/**
 * What a wallet is worth, in a currency people think in.
 *
 * Every rate is an anchor's own SEP-38 indicative price, so it is a real quote
 * from a real Stellar service rather than a number this app invented. When no
 * anchor will quote, this returns nothing and the card shows no conversion — a
 * made-up value on a payment screen is worse than none.
 *
 * A holding the anchor cannot price is left out of the total rather than
 * counted as zero, and if that leaves nothing priced there is no total at all.
 * Quietly under-reporting what someone holds would be the worse failure.
 */
export function useBalanceValue(holdings: Holding[] | undefined) {
  const key = (holdings ?? []).map(holding => `${holding.code}:${holding.amount}`).join(',');

  return useQuery({
    queryKey: ['balance-value', key],
    enabled: (holdings ?? []).some(holding => Number(holding.amount) > 0),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<BalanceValue | null> => {
      const anchor = await discoverAnchor(PRICE_ANCHOR_DOMAIN);
      const priced = (holdings ?? []).filter(holding => Number(holding.amount) > 0);

      let total = 0;
      let currency: string | undefined;

      for (const holding of priced) {
        const sellAsset = payableAssetByCode(holding.code)?.sep38;
        const prices = await readIndicativePrices({
          anchor,
          sellAmount: holding.amount,
          ...(sellAsset ? {sellAsset} : {}),
        });
        const chosen =
          PREFERRED.map(code => prices.find(price => assetCodeOf(price.asset) === code)).find(Boolean) ??
          // Once one holding has fixed the unit, the rest must be read in it or
          // the total would add dollars to lira.
          (currency ? prices.find(price => assetCodeOf(price.asset) === currency) : prices[0]);
        if (!chosen) continue;

        const value = Number(holding.amount) * Number(chosen.price);
        if (!Number.isFinite(value)) continue;

        currency ??= assetCodeOf(chosen.asset);
        if (assetCodeOf(chosen.asset) !== currency) continue;
        total += value;
      }

      if (!currency || total <= 0) return null;
      return {amount: displayAmount(total), currency};
    },
  });
}
