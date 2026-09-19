import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex, concatBytes, utf8ToBytes} from '@noble/hashes/utils.js';

import {paymentIntentV1Schema, type PaymentIntentV1} from './schema';

type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

export const RTP1_SIGNING_DOMAIN = 'RosaPay/RTP/1/PaymentIntent\0';

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const entries = Object.entries(value)
    .sort(([left], [right]) => compareKeys(left, right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`);

  return `{${entries.join(',')}}`;
}

export function canonicalizePaymentIntent(input: unknown): string {
  const intent = paymentIntentV1Schema.parse(input);
  return canonicalize(intent as JsonValue);
}

export function hashPaymentIntent(input: PaymentIntentV1): string {
  return bytesToHex(
    sha256(
      concatBytes(
        utf8ToBytes(RTP1_SIGNING_DOMAIN),
        utf8ToBytes(canonicalizePaymentIntent(input)),
      ),
    ),
  );
}
