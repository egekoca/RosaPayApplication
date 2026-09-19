import {useQuery} from '@tanstack/react-query';
import {Asset} from '@stellar/stellar-sdk';
import {createStellarConfig, readAssetBalance} from '@rosapay/stellar';
import {payableAssets} from '../features/payments/assets';
import {useAppStore} from '../state/appStore';

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
 * A smart wallet is a contract, so its balances only exist through the asset
 * contracts; there is nothing to read until the device has one. Assets the
 * customer has none of are dropped rather than listed at zero — a wallet
 * showing a row of empty balances says nothing except that we support them.
 */
export function useWalletBalance() {
  const smartWallet = useAppStore(state => state.smartWallet);

  return useQuery({
    queryKey: ['wallet-balance', smartWallet?.contractId],
    enabled: Boolean(smartWallet),
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: 1,
    queryFn: async (): Promise<Holding[]> => {
      const config = createStellarConfig('testnet');
      const balances = await Promise.all(
        payableAssets.map(async entry => {
          // One asset failing to read must not blank the whole card; a missing
          // trustline is the ordinary reason and it means "none of this".
          const amount = await readAssetBalance(
            config,
            smartWallet!.contractId,
            contractIdOf(entry, config.networkPassphrase),
          ).catch(() => '0');
          return {code: entry.code, amount};
        }),
      );

      const held = balances.filter(balance => Number(balance.amount) > 0);
      // Lumens are what an empty wallet is empty of, so it is the one to show
      // when there is nothing at all.
      return held.length > 0 ? held : [{code: 'XLM', amount: '0'}];
    },
  });
}
