import {useQuery} from '@tanstack/react-query';
import {assetCodeOf, currencyValueOfAsset, readIndicativePrices} from '@rosapay/anchor';
import {payableAssetByCode} from '../features/payments/assets';
import type {Holding} from './useWalletBalance';
import {displayAmount} from './displayAmount';
import {PREFERRED_CURRENCIES, resolveQuoteSource} from './priceSource';
import {useAppStore} from '../state/appStore';

export type BalanceValue = {amount: string; currency: string};

/**
 * What a wallet is worth, in a currency people think in.
 *
 * Every rate is a SEP-38 indicative price from the configured quote server, so
 * it is a real market number rather than one this app invented. When nothing
 * will quote, this returns nothing and the card shows no conversion — a
 * made-up value on a payment screen is worse than none.
 *
 * Lira first, because that is the money the people using this count in. A
 * holding that cannot be priced is left out of the total rather than counted as
 * zero, and if that leaves nothing priced there is no total at all. Quietly
 * under-reporting what someone holds would be the worse failure.
 */
export function useBalanceValue(holdings: Holding[] | undefined) {
  const wanted = useAppStore(state => state.displayCurrency);
  const key = (holdings ?? []).map(holding => `${holding.code}:${holding.amount}`).join(',');

  return useQuery({
    queryKey: ['balance-value', key, wanted],
    enabled: (holdings ?? []).some(holding => Number(holding.amount) > 0),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<BalanceValue | null> => {
      const priced = (holdings ?? []).filter(holding => Number(holding.amount) > 0);
      // The chosen currency first, then the old order as a fallback: a wallet
      // holding something nobody will price in lira should still read as
      // something rather than as nothing.
      const order = [wanted, ...PREFERRED_CURRENCIES.filter(code => code !== wanted)];

      let total = 0;
      let currency: string | undefined;

      for (const holding of priced) {
        const sellAsset = payableAssetByCode(holding.code)?.sep38;
        // Each holding is priced by whichever server quotes that asset, so a
        // wallet of lumens and USDC still totals in one currency.
        const source = await resolveQuoteSource(sellAsset, currency ?? wanted);
        const prices = await readIndicativePrices({
          source,
          sellAmount: holding.amount,
          ...(sellAsset ? {sellAsset} : {}),
        });
        const chosen =
          order.map(code => prices.find(price => assetCodeOf(price.asset) === code)).find(Boolean) ??
          // Once one holding has fixed the unit, the rest must be read in it or
          // the total would add dollars to lira.
          (currency ? prices.find(price => assetCodeOf(price.asset) === currency) : prices[0]);
        if (!chosen) continue;

        const value = currencyValueOfAsset({amount: holding.amount, price: chosen.price});
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
