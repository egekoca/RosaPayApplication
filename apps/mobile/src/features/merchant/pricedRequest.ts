import {assetAmountForPrice, type CurrencyPrice} from '@rosapay/anchor';

export type PricedRequest = {
  /** What the customer is asked to send, in the settlement asset. */
  assetAmount: string;
  /** The price as the merchant named it, e.g. `500.00 TRY`. */
  label: string;
};

/**
 * Turns a price on a menu into an amount of the asset, or nothing.
 *
 * A merchant prices a coffee in the money their customers count in; the
 * contract moves an asset. This is where one becomes the other, using the
 * anchor's rate. It returns nothing rather than guessing, so a screen can stay
 * silent until there is something true to show.
 */
export function priceRequest(input: {
  amount: string;
  currency: CurrencyPrice | undefined;
}): PricedRequest | undefined {
  if (!input.currency || !input.amount.trim()) return undefined;
  try {
    return {
      assetAmount: assetAmountForPrice({amount: input.amount, perUnit: input.currency.perUnit}),
      label: `${Number(input.amount).toFixed(2)} ${input.currency.currency}`,
    };
  } catch {
    return undefined;
  }
}

/**
 * What the customer reads on the confirmation screen.
 *
 * The priced amount travels in the reference because that field is already
 * signed and already shown. Without it a customer asked for 500 lira would see
 * only an amount of lumens and have no way to check it against the till.
 */
export function referenceForRequest(reference: string, priced: PricedRequest | undefined): string {
  if (!priced) return reference;
  return [reference.trim(), priced.label].filter(Boolean).join(' · ');
}
