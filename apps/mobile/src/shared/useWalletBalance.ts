import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Asset} from '@stellar/stellar-sdk';
import {createStellarConfig, readAssetBalance} from '@rosapay/stellar';
import {payableAssets} from '../features/payments/assets';
import {needsTrustlines, useCurrentAccount} from '../features/wallet/currentAccount';
import {useAppStore} from '../state/appStore';
import {applyUnreconciledSpend, unreconciledSpend} from './unreconciledSpend';

export type Holding = {code: string; amount: string};

/** The SAC a payable asset moves through, which is also where its balance lives. */
function contractIdOf(asset: (typeof payableAssets)[number], networkPassphrase: string): string {
  return asset.asset.type === 'native'
    ? Asset.native().contractId(networkPassphrase)
    : new Asset(asset.asset.code, asset.asset.issuer!).contractId(networkPassphrase);
}

/**
 * What the customer holds, one entry per asset they could pay with.
 *
 * Balances are read through each asset's own contract, which answers for a
 * contract account and a classic one alike; there is nothing to read until the
 * phone has an account at all. Assets the customer has none of are dropped
 * rather than listed at zero — a wallet showing a row of empty balances says
 * nothing except that we support them.
 */
export function useWalletBalance() {
  const account = useCurrentAccount();
  const receipts = useAppStore(state => state.receipts);

  const query = useQuery({
    queryKey: ['wallet-balance', account?.address],
    enabled: Boolean(account),
    refetchInterval: 20_000,
    staleTime: 10_000,
    // Two concurrent reads against a shared public RPC, so one of them being
    // slow this cycle is routine rather than exceptional. A single retry gave
    // that maybe a second to recover before the card had to say "reconnecting"
    // to someone who was just looking at a real balance a moment ago. Matching
    // the app's own default (2) buys a few seconds of backoff, which a
    // transient blip clears well inside.
    retry: 2,
    queryFn: async (): Promise<Holding[]> => {
      const config = createStellarConfig('testnet');
      /*
       * What a failed read means depends on which account this is.
       *
       * A contract account needs no trustline, so every asset answers — zero
       * when it has never been paid. The only thing a failure can mean there is
       * that the ledger was unreachable, and calling that zero once told
       * someone holding USDC that they held none. So it is left to throw, the
       * card goes to its reconnecting state, and the query retries.
       *
       * A classic account is the opposite: without a trustline the asset cannot
       * reach it at all and the balance call fails outright. There, a failure
       * on a non-native asset honestly means "none of this", and throwing would
       * put a working wallet permanently in an error state.
       */
      const classic = needsTrustlines(account);
      const balances = await Promise.all(
        payableAssets.map(async entry => {
          const read = readAssetBalance(
            config,
            account!.address,
            contractIdOf(entry, config.networkPassphrase),
          );
          const amount =
            classic && entry.asset.type !== 'native' ? await read.catch(() => '0') : await read;
          return {code: entry.code, amount};
        }),
      );

      const held = balances.filter(balance => Number(balance.amount) > 0);
      // Lumens are what an empty wallet is empty of, so it is the one to show
      // when there is nothing at all.
      return held.length > 0 ? held : [{code: 'XLM', amount: '0'}];
    },
  });

  /**
   * What is left, rather than what was there when this last reached the chain.
   *
   * This is the half of the picture a phone keeps for itself. Paying across a
   * counter with no connection settles on the chain but changes nothing this
   * phone can see, so without it the card would keep showing the balance from
   * before the payment for as long as the customer stayed offline — and go on
   * showing it while they walked to the next counter.
   */
  const spent = useMemo(
    () => unreconciledSpend(receipts, query.dataUpdatedAt),
    [receipts, query.dataUpdatedAt],
  );
  const data = useMemo(() => applyUnreconciledSpend(query.data, spent), [query.data, spent]);

  return {
    ...query,
    data,
    /** True while this is showing a balance the chain has not confirmed back. */
    unreconciled: spent.size > 0,
  };
}
