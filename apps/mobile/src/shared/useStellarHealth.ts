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

/**
 * Reads the ledger once, now, for a decision that cannot wait on a cache.
 *
 * A tap or a Bluetooth arrival has to be checked against a live observation,
 * and it happens when a customer walks up rather than on any schedule. Polling
 * for it would mean a network request every few seconds for as long as the app
 * is open, to hold a number that is re-read the moment it is actually needed.
 *
 * Anything that is not a plausible ledger — an error, a malformed body, a
 * number that cannot be one — comes back undefined, so the caller fails closed
 * rather than treating a broken answer as a fresh one.
 */
export async function readLatestLedger(): Promise<number | undefined> {
  try {
    const ledger = (await testnetRpc.health()).latestLedger;
    if (typeof ledger !== 'number' || !Number.isSafeInteger(ledger) || ledger <= 0) return undefined;
    return ledger;
  } catch {
    return undefined;
  }
}
