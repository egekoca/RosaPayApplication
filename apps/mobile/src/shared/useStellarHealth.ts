import {useQuery, type QueryClient} from '@tanstack/react-query';
import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';

const testnetRpc = new StellarRpcClient(createStellarConfig('testnet'));

/** Shared so a read taken outside a component lands in the same cache. */
const stellarHealthKey = ['stellar', 'rpc-health', 'testnet'] as const;
const fetchStellarHealth = () => testnetRpc.health();

export function useStellarHealth(enabled = true) {
  return useQuery({
    queryKey: stellarHealthKey,
    enabled,
    queryFn: fetchStellarHealth,
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
 * Reads the ledger for a decision that cannot wait on a schedule.
 *
 * A Bluetooth arrival has to be checked against a live observation, and it
 * happens when a customer walks up rather than on any timer. Polling for it
 * would mean a network request every few seconds for as long as the app is
 * open, to hold a number that is read the moment it is actually needed.
 *
 * Given a `client` the read goes through the same cache the confirmation
 * screen watches, which is the point: that screen re-reads the ledger on
 * mount and cannot offer Approve until it has one, so a read taken here and
 * thrown away meant the customer waited out two round trips back to back —
 * one before the screen opened and one after, for the same number. It is
 * still a real read; `staleTime` only lets the screen open on an observation
 * seconds old instead of blocking on a fresh one, which is the same freshness
 * that screen already accepts while it is open.
 *
 * Anything that is not a plausible ledger — an error, a malformed body, a
 * number that cannot be one — comes back undefined, so the caller fails closed
 * rather than treating a broken answer as a fresh one.
 */
export async function readLatestLedger(client?: QueryClient): Promise<number | undefined> {
  try {
    const health = client
      ? await client.fetchQuery({
          queryKey: stellarHealthKey,
          queryFn: fetchStellarHealth,
          staleTime: 15_000,
        })
      : await fetchStellarHealth();
    const ledger = health.latestLedger;
    if (typeof ledger !== 'number' || !Number.isSafeInteger(ledger) || ledger <= 0) return undefined;
    return ledger;
  } catch {
    return undefined;
  }
}
