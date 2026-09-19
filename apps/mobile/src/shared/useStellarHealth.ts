import {useQuery} from '@tanstack/react-query';
import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';

const testnetRpc = new StellarRpcClient(createStellarConfig('testnet'));

export function useStellarHealth() {
  return useQuery({
    queryKey: ['stellar', 'rpc-health', 'testnet'],
    queryFn: () => testnetRpc.health(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
