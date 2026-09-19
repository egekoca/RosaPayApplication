import {useQuery} from '@tanstack/react-query';
import {Asset} from '@stellar/stellar-sdk';
import {canReceiveAsset, createStellarConfig} from '@rosapay/stellar';
import type {PayableAsset} from '../payments/assets';

/**
 * Whether the merchant's receiving address could actually accept this asset.
 *
 * A classic account holds a credit asset only once it has a trustline for it,
 * and the settlement would fail without one. Asking here means a merchant finds
 * out while choosing, rather than at the till with a customer already holding
 * their phone out.
 *
 * A contract address — the phone's own wallet, for instance — needs nothing,
 * because a Stellar Asset Contract keeps its balance in contract storage.
 */
export function useRecipientCanReceive(recipient: string | undefined, payable: PayableAsset) {
  const config = createStellarConfig('testnet');
  const assetContractId =
    payable.asset.type === 'native'
      ? Asset.native().contractId(config.networkPassphrase)
      : new Asset(payable.asset.code, payable.asset.issuer!).contractId(config.networkPassphrase);

  return useQuery({
    queryKey: ['recipient-can-receive', recipient, assetContractId],
    enabled: Boolean(recipient),
    staleTime: 60_000,
    retry: 1,
    queryFn: () => canReceiveAsset(config, recipient!, assetContractId),
  });
}
