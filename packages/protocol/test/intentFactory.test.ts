import {describe, expect, it} from 'vitest';
import {
  createIntentIdentifiers,
  createPaymentIntent,
  DEFAULT_INTENT_LIFETIME_LEDGERS,
  IntentFactoryError,
  normalizePaymentAmount,
  type MerchantProfileSummary,
} from '../src/intentFactory';
import {hashPaymentIntent} from '../src/canonical';

const profile: MerchantProfileSummary = {
  merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
  merchantName: '  Rose Coffee  ',
  merchantSigningKey: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
  recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  network: 'testnet',
};

const base = {
  profile,
  amount: '24.50',
  reference: '  Table 08  ',
  latestLedger: 1_500_000,
  intentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
  createdAt: '2026-08-23T00:00:00.000Z',
};

describe('payment intent factory', () => {
  it('builds a canonical intent from merchant profile data', () => {
    const intent = createPaymentIntent(base);

    expect(intent).toMatchObject({
      version: 'RTP/1',
      network: 'testnet',
      merchantName: 'Rose Coffee',
      merchantProfileId: profile.merchantProfileId,
      recipient: profile.recipient,
      amount: '24.5',
      reference: 'Table 08',
      asset: {type: 'native', code: 'XLM', decimals: 7},
      expiresAtLedger: 1_500_000 + DEFAULT_INTENT_LIFETIME_LEDGERS,
    });
    expect(hashPaymentIntent(intent)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts an explicit lifetime and rejects one outside policy', () => {
    expect(createPaymentIntent({...base, lifetimeLedgers: 60}).expiresAtLedger).toBe(1_500_060);
    expect(() => createPaymentIntent({...base, lifetimeLedgers: 0})).toThrow(IntentFactoryError);
    expect(() => createPaymentIntent({...base, lifetimeLedgers: 5_000})).toThrow('between 1 and 1440 ledgers');
  });

  it('rejects an unusable latest ledger', () => {
    expect(() => createPaymentIntent({...base, latestLedger: 0})).toThrow('positive latest ledger');
  });

  it('rejects merchant data the RTP/1 schema does not allow', () => {
    expect(() => createPaymentIntent({...base, profile: {...profile, recipient: 'not-an-address'}})).toThrow();
    expect(() => createPaymentIntent({...base, reference: '   '})).toThrow();
  });

  it('carries a credit asset issuer through to the intent', () => {
    const intent = createPaymentIntent({
      ...base,
      amount: '10.00',
      asset: {type: 'credit', code: 'USDC', issuer: profile.merchantSigningKey, decimals: 7},
    });
    expect(intent.asset).toMatchObject({type: 'credit', code: 'USDC', issuer: profile.merchantSigningKey});
    expect(intent.amount).toBe('10');
  });
});

describe('amount normalization', () => {
  it('canonicalizes keypad input', () => {
    expect(normalizePaymentAmount('024.50', 7)).toBe('24.5');
    expect(normalizePaymentAmount('0.5000', 7)).toBe('0.5');
    expect(normalizePaymentAmount('24.0', 7)).toBe('24');
    expect(normalizePaymentAmount(' 7 ', 7)).toBe('7');
  });

  it('rejects zero, malformed and over-precise amounts', () => {
    expect(() => normalizePaymentAmount('0', 7)).toThrow('greater than zero');
    expect(() => normalizePaymentAmount('0.0000000', 7)).toThrow('greater than zero');
    expect(() => normalizePaymentAmount('24.', 7)).toThrow('positive decimal');
    expect(() => normalizePaymentAmount('-5', 7)).toThrow('positive decimal');
    expect(() => normalizePaymentAmount('1.12345678', 7)).toThrow('at most 7 decimal places');
  });
});

describe('intent identifiers', () => {
  it('draws a UUID v4 and a 16-byte nonce from the injected source', () => {
    const identifiers = createIntentIdentifiers(size => new Uint8Array(size).fill(0xab));
    expect(identifiers.intentId).toBe('abababab-abab-4bab-abab-abababababab');
    expect(identifiers.nonce).toBe('ab'.repeat(16));
    expect(createPaymentIntent({...base, ...identifiers}).intentId).toBe(identifiers.intentId);
  });

  it('refuses a randomness source that returns the wrong size', () => {
    expect(() => createIntentIdentifiers(() => new Uint8Array(4))).toThrow('must return 16 bytes');
  });
});
