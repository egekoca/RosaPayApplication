import {describe, expect, it} from 'vitest';

import {
  canonicalizePaymentIntent,
  decodePaymentQr,
  encodePaymentQr,
  hashPaymentIntent,
  validatePaymentIntent,
} from '../src';
import {validSignedIntent} from './fixtures';

describe('RTP/1', () => {
  it('produces a stable canonical encoding and hash', () => {
    const canonical = canonicalizePaymentIntent(validSignedIntent.intent);
    expect(canonical).toContain('"amount":"24.5"');
    expect(hashPaymentIntent(validSignedIntent.intent)).toBe(
      '638c86388972d93c983c83adf8b472c7c698ccb66a918ea2a79b70430bbd0075',
    );
    expect(hashPaymentIntent({...validSignedIntent.intent})).toBe(hashPaymentIntent(validSignedIntent.intent));
  });

  it('round trips a signed QR payload', () => {
    expect(decodePaymentQr(encodePaymentQr(validSignedIntent))).toEqual(validSignedIntent);
  });

  it('rejects network mismatches and expired intents', () => {
    expect(() =>
      validatePaymentIntent(validSignedIntent.intent, {network: 'pubnet', latestLedger: 1}),
    ).toThrow('Intent targets testnet');
    expect(() =>
      validatePaymentIntent(validSignedIntent.intent, {network: 'testnet', latestLedger: 1_500_120}),
    ).toThrow('expired');
  });

  it('rejects asset substitution and non-canonical amounts', () => {
    expect(() =>
      validatePaymentIntent(
        {...validSignedIntent.intent, amount: '24.50'},
        {network: 'testnet', latestLedger: 1_500_000},
      ),
    ).toThrow();
    expect(() =>
      validatePaymentIntent(
        {...validSignedIntent.intent, asset: {type: 'credit', code: 'USDC', decimals: 7}},
        {network: 'testnet', latestLedger: 1_500_000},
      ),
    ).toThrow('issuer');
  });
});
