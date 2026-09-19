import {useQuery} from '@tanstack/react-query';
import {assetCodeOf, currencyValueOfAsset, readIndicativePrices} from '@rosapay/anchor';
import {payableAssetByCode} from '../features/payments/assets';
import type {Holding} from './useWalletBalance';
import {displayAmount} from './displayAmount';
import {readMarketIndicativePrices, resolveQuoteSource} from './priceSource';
import {useAppStore} from '../state/appStore';

/** One holding, and what it is worth in the chosen currency. */
export type ValuedHolding = {code: string; amount: string; value: string};

export type BalanceValue = {
  amount: string;
  currency: string;
  /**
   * Per holding, in the order the wallet reports them. The total alone answers
   * "what is this worth"; the breakdown answers "worth of what", which is the
   * question anyone holding two assets actually has.
   */
  holdings: ValuedHolding[];
};

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

      let total = 0;
      const currency = wanted;
      const valued: ValuedHolding[] = [];

      for (const holding of priced) {
        const sellAsset = payableAssetByCode(holding.code)?.sep38;
        // Each holding is priced by whichever server quotes that asset, so a
        // wallet of lumens and USDC still totals in one currency.
        const source = await resolveQuoteSource(sellAsset, currency);
        let prices = await readIndicativePrices({
          source,
          sellAmount: holding.amount,
          ...(sellAsset ? {sellAsset} : {}),
        });
        /*
         * The currency that was asked for, and no other.
         *
         * This used to fall through a preference order, so a wallet asked for
         * dollars answered in lira whenever nothing would quote dollars. The
         * figure was labelled honestly and was still the wrong answer: someone
         * who picks USD and reads "₺50,732.12 TRY" concludes the control is
         * broken, which is what was reported. Showing nothing is the honest
         * outcome — the card has a state for a rate it does not have, and a
         * currency nobody will quote is exactly that state.
         */
        let chosen = prices.find(price => assetCodeOf(price.asset) === currency);
        // Render can briefly serve an older image that only knows TRY/USD.
        // Fill the missing display currency from the public market feed; this
        // never participates in signing or settlement.
        if (!chosen && sellAsset) {
          try {
            prices = await readMarketIndicativePrices(sellAsset);
            chosen = prices.find(price => assetCodeOf(price.asset) === currency);
          } catch {
            // A display feed outage must not turn a readable wallet into an
            // error state; the holding itself remains available on the card.
          }
        }
        if (!chosen) continue;

        const value = currencyValueOfAsset({amount: holding.amount, price: chosen.price});
        if (!Number.isFinite(value)) continue;

        total += value;
        valued.push({code: holding.code, amount: holding.amount, value: displayAmount(value)});
      }

      if (!currency || total <= 0) return null;
      return {amount: displayAmount(total), currency, holdings: valued};
    },
  });
}
