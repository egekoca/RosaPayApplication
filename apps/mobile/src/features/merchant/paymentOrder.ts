import {paymentOutcome} from './paymentOutcome';

/** How many rows a merchant is shown before asking for more. */
export const MERCHANT_PAGE_SIZE = 6;

/** Only what the ordering reads, so both the API's shape and the device's fit. */
export type OrderablePayment = {
  intentId: string;
  status: string;
  createdAt: string;
};

/**
 * The order a counter reads in.
 *
 * Newest-first alone buries the request a merchant is standing over: a busy day
 * puts this morning's paid coffees above the code on the counter right now, and
 * the one row that is still doing something scrolls away. Open requests come
 * first for that reason — they are the only rows with anything left to happen —
 * and within each group the newest is the one being asked about.
 *
 * Everything else keeps its place rather than being hidden. A merchant checking
 * whether a payment landed is looking for a row that is finished, and a list
 * that only showed live requests would have nowhere for that question to go.
 */
export function orderMerchantPayments<T extends OrderablePayment>(payments: readonly T[]): T[] {
  return [...payments].sort((left, right) => {
    const leftOpen = paymentOutcome(left.status) === 'open';
    const rightOpen = paymentOutcome(right.status) === 'open';
    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;
    return timeOf(right) - timeOf(left);
  });
}

/**
 * An unparseable date sorts last rather than throwing the whole list into an
 * arbitrary order: `NaN` compares false against everything, which silently
 * scrambles a sort rather than failing it.
 */
function timeOf(payment: OrderablePayment): number {
  const parsed = Date.parse(payment.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}
