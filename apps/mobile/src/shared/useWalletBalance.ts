import {useQuery} from '@tanstack/react-query';
import {createStellarConfig, readNativeBalance} from '@rosapay/stellar';
import {useAppStore} from '../state/appStore';

/**
 * The customer's real XLM balance. A smart wallet is a contract, so its balance
 * only exists through the asset contract; there is nothing to show until the
 * device has one.
 */
export function useWalletBalance() {
  const smartWallet = useAppStore(state => state.smartWallet);
  const settlementMode = useAppStore(state => state.settlementMode);

  return useQuery({
    queryKey: ['wallet-balance', smartWallet?.contractId],
    enabled: settlementMode === 'testnet' && Boolean(smartWallet),
    queryFn: () => readNativeBalance(createStellarConfig('testnet'), smartWallet!.contractId),
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: 1,
  });
}
