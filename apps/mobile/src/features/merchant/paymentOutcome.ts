import type {PaymentStatus} from '@rosapay/domain';

/**
 * What a merchant needs to know about one request at a glance: whether money
 * arrived, whether it still might, or whether the request is over.
 *
 * The API and this device's own receipts both carry the settlement status, and
 * eight of them is more than a row in a list can say. Three is what a merchant
 * is actually asking: is it paid, is it live, or is it done with.
 */
export type PaymentOutcome = 'paid' | 'open' | 'closed';

/**
 * `expired` is the one worth naming separately in the copy, because it is the
 * only closed state with an obvious next move — make a new request. The rest
 * are failures a merchant can only be told about.
 */
export function paymentOutcome(status: PaymentStatus | string): PaymentOutcome {
  if (status === 'confirmed') return 'paid';
  if (status === 'created' || status === 'awaiting_approval' || status === 'authorized' || status === 'submitted') {
    return 'open';
  }
  return 'closed';
}

/**
 * Whether the QR and the radios for this request are still worth showing.
 *
 * A request leaves `awaiting_approval` the moment a customer claims it, so this
 * is narrower than "not closed": an authorized request is on its way to the
 * chain and must not be handed to a second customer.
 */
export function isOfferable(status: PaymentStatus | string): boolean {
  return status === 'awaiting_approval';
}
