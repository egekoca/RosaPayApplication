import {bytesToHex} from '@noble/hashes/utils.js';
import {
  paymentIntentV1Schema,
  type PaymentAsset,
  type PaymentIntentV1,
} from './schema';

export const NATIVE_XLM: PaymentAsset = {type: 'native', code: 'XLM', decimals: 7};

/** ~5 second ledgers: merchant QR requests are valid for about five minutes. */
export const DEFAULT_INTENT_LIFETIME_LEDGERS = 60;
/** Keep caller-provided lifetimes bounded to the same short-lived QR policy. */
export const MAX_INTENT_LIFETIME_LEDGERS = 60;
/**
 * The bound a *reader* applies, which is deliberately looser than the bound a
 * *writer* is held to. Nobody in the flow shares one clock: the merchant, the
 * API and the customer each learn `latestLedger` from their own RPC poll, and a
 * reader whose poll is a few ledgers behind the merchant's sees a lifetime
 * longer than the one that was actually minted. Rejecting that as
 * `EXPIRY_TOO_FAR` would fail an honest tap. The slack is a minute of ledgers —
 * far short of the replay window the bound exists to close.
 */
export const MAX_INTENT_ACCEPTANCE_LEDGERS = MAX_INTENT_LIFETIME_LEDGERS + 12;

export class IntentFactoryError extends Error {
  override readonly name = 'IntentFactoryError';
}

export type MerchantProfileSummary = {
  merchantProfileId: string;
  merchantName: string;
  merchantSigningKey: string;
  recipient: string;
  network: PaymentIntentV1['network'];
};

export type CreatePaymentIntentInput = {
  profile: MerchantProfileSummary;
  amount: string;
  reference: string;
  latestLedger: number;
  intentId: string;
  nonce: string;
  createdAt: string;
  asset?: PaymentAsset;
  lifetimeLedgers?: number;
};

/**
 * Builds an RTP/1 intent from merchant profile data instead of a fixture. The
 * identifier, nonce and clock are injected so a caller stays deterministic and
 * the randomness source is an explicit decision rather than a hidden default.
 */
export function createPaymentIntent(input: CreatePaymentIntentInput): PaymentIntentV1 {
  const asset = input.asset ?? NATIVE_XLM;
  const lifetime = input.lifetimeLedgers ?? DEFAULT_INTENT_LIFETIME_LEDGERS;

  if (!Number.isSafeInteger(input.latestLedger) || input.latestLedger <= 0) {
    throw new IntentFactoryError('A positive latest ledger is required to set an expiry');
  }
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0 || lifetime > MAX_INTENT_LIFETIME_LEDGERS) {
    throw new IntentFactoryError(`Intent lifetime must be between 1 and ${MAX_INTENT_LIFETIME_LEDGERS} ledgers`);
  }

  return paymentIntentV1Schema.parse({
    version: 'RTP/1',
    intentId: input.intentId,
    network: input.profile.network,
    merchantProfileId: input.profile.merchantProfileId,
    merchantName: input.profile.merchantName.trim(),
    merchantSigningKey: input.profile.merchantSigningKey,
    recipient: input.profile.recipient,
    asset,
    amount: normalizePaymentAmount(input.amount, asset.decimals),
    reference: input.reference.trim(),
    nonce: input.nonce,
    expiresAtLedger: input.latestLedger + lifetime,
    createdAt: input.createdAt,
  });
}

/**
 * Turns keypad input such as `024.50` into the canonical `24.5` the RTP/1 schema
 * and the contract both expect, and refuses anything that is not a positive
 * amount within the asset's precision.
 */
export function normalizePaymentAmount(value: string, decimals: number): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new IntentFactoryError('Amount must be a positive decimal number');
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new IntentFactoryError('Asset decimals must be between 0 and 18');
  }

  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    throw new IntentFactoryError(`Amount supports at most ${decimals} decimal places`);
  }

  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction.replace(/0+$/, '');
  if (normalizedWhole === '0' && normalizedFraction === '') {
    throw new IntentFactoryError('Amount must be greater than zero');
  }
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

export type RandomBytes = (size: number) => Uint8Array;

export type IntentIdentifiers = {
  intentId: string;
  nonce: string;
};

/** Draws the identifier and nonce from an explicit randomness source. */
export function createIntentIdentifiers(randomBytes: RandomBytes): IntentIdentifiers {
  return {intentId: randomUuidV4(randomBytes), nonce: bytesToHex(requireBytes(randomBytes, 16))};
}

function randomUuidV4(randomBytes: RandomBytes): string {
  const bytes = requireBytes(randomBytes, 16);
  // RFC 4122 version 4, variant 10xx.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function requireBytes(randomBytes: RandomBytes, size: number): Uint8Array {
  const bytes = randomBytes(size);
  if (!(bytes instanceof Uint8Array) || bytes.length !== size) {
    throw new IntentFactoryError(`The randomness source must return ${size} bytes`);
  }
  return bytes;
}
