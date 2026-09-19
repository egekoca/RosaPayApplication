import {parseSignedPaymentIntent} from './validation';
import type {SignedPaymentIntentV1} from './schema';
import {Base64} from 'js-base64';

const RTP_SCHEME = 'rosapay://pay/';

/**
 * A signed intent encodes to roughly 700 characters, and QR itself tops out near
 * 3 kB. Anything larger did not come from a Rosa Pay merchant, so the decoder
 * refuses it before parsing rather than handing arbitrary input to JSON.parse.
 */
const MAX_QR_LENGTH = 4_096;

function encodeBase64Url(value: string): string {
  return Base64.encodeURI(value);
}

function decodeBase64Url(value: string): string {
  return Base64.decode(value);
}

export function encodePaymentQr(payload: SignedPaymentIntentV1): string {
  const parsed = parseSignedPaymentIntent(payload);
  return `${RTP_SCHEME}${encodeBase64Url(JSON.stringify(parsed))}`;
}

export function decodePaymentQr(value: string): SignedPaymentIntentV1 {
  if (value.length > MAX_QR_LENGTH) {
    throw new Error('This code is too large to be a payment request');
  }
  if (!value.startsWith(RTP_SCHEME)) {
    throw new Error('Unsupported payment QR');
  }

  const encoded = value.slice(RTP_SCHEME.length);
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeBase64Url(encoded));
  } catch {
    // A truncated or corrupted scan is expected, not exceptional: the customer
    // should be told to try again rather than shown a parser error.
    throw new Error('This payment request could not be read');
  }
  return parseSignedPaymentIntent(decoded);
}
