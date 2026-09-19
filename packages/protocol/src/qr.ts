import {parseSignedPaymentIntent} from './validation';
import type {SignedPaymentIntentV1} from './schema';
import {Base64} from 'js-base64';

const RTP_SCHEME = 'rosapay://pay/';

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
  if (!value.startsWith(RTP_SCHEME)) {
    throw new Error('Unsupported payment QR');
  }
  return parseSignedPaymentIntent(JSON.parse(decodeBase64Url(value.slice(RTP_SCHEME.length))));
}
