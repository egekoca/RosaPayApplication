import {useQuery} from '@tanstack/react-query';
import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';

const testnetRpc = new StellarRpcClient(createStellarConfig('testnet'));

export function useStellarHealth(enabled = true) {
  return useQuery({
    queryKey: ['stellar', 'rpc-health', 'testnet'],
    enabled,
    queryFn: () => testnetRpc.health(),
    // Ledger expiry is part of the payment policy, so a foreground merchant or
    // customer should not keep a request's status on a half-minute-old view.
    refetchInterval: 5_000,
    // A newly mounted Confirm screen must verify the ledger even when another
    // screen left a still-fresh value in React Query's cache.
    refetchOnMount: 'always',
    staleTime: 15_000,
  });
}
