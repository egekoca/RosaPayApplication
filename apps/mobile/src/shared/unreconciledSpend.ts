import type {Holding} from './useWalletBalance';
import type {LocalReceipt} from '../state/appStore';

/**
 * What this phone has spent since the last time it could read the chain.
 *
 * A balance is a photograph of the ledger, and a phone with no network is
 * holding an old one. That matters here more than in most wallets: paying
 * across the counter with no connection is the whole point of this app, so the
 * moment a customer does it their card is out of date and there is nothing to
 * refresh it with. Left alone it would keep saying fifty while ten was the
 * truth — not a way to spend fifty twice, because the chain refuses that long
 * before anyone signs anything, but a number that lies to the person deciding
 * whether to walk up to the next counter.
 *
 * So the app subtracts what it knows: every payment it saw confirmed after that
 * photograph was taken. It can only ever be a floor — money arriving from
 * someone else goes unseen until the network is back — which is the right way
 * round, because a floor understates what can be spent and never overstates it.
 */
export function unreconciledSpend(
  receipts: readonly LocalReceipt[],
  readAt: number | undefined,
): Map<string, number> {
  const spent = new Map<string, number>();
  if (!readAt) return spent;

  for (const receipt of receipts) {
    if (receipt.status !== 'confirmed') continue;
    // A receipt with no transaction is local demo state and moved nothing.
    if (!receipt.transactionHash) continue;
    const at = Date.parse(receipt.confirmedAt ?? receipt.createdAt);
    if (!Number.isFinite(at) || at <= readAt) continue;
    const amount = Number(receipt.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    spent.set(receipt.assetCode, (spent.get(receipt.assetCode) ?? 0) + amount);
  }
  return spent;
}

/** Seven decimal places, which is what a Stellar amount has. */
function toStellarAmount(value: number): string {
  return (Math.round(value * 1e7) / 1e7).toFixed(7).replace(/\.?0+$/, '') || '0';
}

/**
 * The holdings with that spend taken off, so the card says what is left rather
 * than what was there.
 *
 * An asset spent down to nothing keeps its row at zero instead of disappearing:
 * a row that vanishes reads as a failed read, and this is the opposite — it is
 * the one number here we are most sure of.
 */
export function applyUnreconciledSpend(
  holdings: readonly Holding[] | undefined,
  spent: Map<string, number>,
): Holding[] | undefined {
  if (!holdings) return holdings;
  if (spent.size === 0) return holdings as Holding[];

  return holdings.map(holding => {
    const outgoing = spent.get(holding.code);
    if (!outgoing) return holding;
    const remaining = Math.max(Number(holding.amount) - outgoing, 0);
    return {code: holding.code, amount: toStellarAmount(remaining)};
  });
}

/**
 * What one asset is known to be worth right now, or nothing when this phone has
 * never managed to read it.
 *
 * Used before a payment rather than after: a customer about to approve an
 * amount their wallet cannot cover should be told by their own phone, not by a
 * merchant's failure a minute later.
 */
export function knownHolding(
  holdings: readonly Holding[] | undefined,
  assetCode: string,
): number | undefined {
  const holding = holdings?.find(entry => entry.code === assetCode);
  if (!holding) return undefined;
  const amount = Number(holding.amount);
  return Number.isFinite(amount) ? amount : undefined;
}
