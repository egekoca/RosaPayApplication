import {verifyMerchantSignature} from '@rosapay/stellar/merchant-signature';
import {decodePaymentQr, encodePaymentQr, validatePaymentIntent} from '@rosapay/protocol';
import {
  createMerchantProfile,
  createSignedPaymentRequest,
  MerchantProfileError,
} from '../src/features/merchant/merchantProfile';
import {createRandomBytes, RandomnessUnavailableError} from '../src/shared/randomBytes';

const randomBytes = createRandomBytes({allowInsecureFallback: true});
const draft = {displayName: '  Rose Coffee ', recipient: 'gdveu3dd4kofecv66vihwezoyx4zkr3wv27l464siipou2iui3jcza57'};

describe('merchant profile', () => {
  it('normalizes the draft and derives a Stellar signing key', () => {
    const profile = createMerchantProfile(draft, randomBytes);

    expect(profile.displayName).toBe('Rose Coffee');
    expect(profile.recipient).toBe(draft.recipient.toUpperCase());
    expect(profile.signingKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(profile.network).toBe('testnet');
  });

  it('rejects an empty name and an invalid receiving address', () => {
    expect(() => createMerchantProfile({...draft, displayName: '   '}, randomBytes)).toThrow(MerchantProfileError);
    expect(() => createMerchantProfile({...draft, recipient: 'GNOTREAL'}, randomBytes)).toThrow('valid Stellar address');
  });

  it('creates a request the customer path decodes, validates and verifies', () => {
    const profile = createMerchantProfile(draft, randomBytes);
    const request = createSignedPaymentRequest(profile, {amount: '024.50', reference: ' Table 08 ', latestLedger: 1_500_000}, randomBytes);

    expect(request.intent.amount).toBe('24.5');
    expect(request.intent.reference).toBe('Table 08');
    expect(request.intent.expiresAtLedger).toBe(1_500_120);

    const scanned = decodePaymentQr(encodePaymentQr(request));
    validatePaymentIntent(scanned.intent, {network: 'testnet', latestLedger: 1_500_000, maxLedgerLifetime: 1_440});
    expect(verifyMerchantSignature(scanned)).toBe(true);
  });

  it('fails verification when the amount is altered after signing', () => {
    const profile = createMerchantProfile(draft, randomBytes);
    const request = createSignedPaymentRequest(profile, {amount: '10', reference: 'Table 08', latestLedger: 1_500_000}, randomBytes);

    expect(verifyMerchantSignature({...request, intent: {...request.intent, amount: '1000'}})).toBe(false);
  });

  it('refuses to build a request without a ledger, a reference or a usable amount', () => {
    const profile = createMerchantProfile(draft, randomBytes);

    expect(() => createSignedPaymentRequest(profile, {amount: '10', reference: 'Table 08', latestLedger: undefined}, randomBytes))
      .toThrow('Testnet is unavailable');
    expect(() => createSignedPaymentRequest(profile, {amount: '10', reference: '  ', latestLedger: 1_500_000}, randomBytes))
      .toThrow('short reference');
    expect(() => createSignedPaymentRequest(profile, {amount: '0', reference: 'Table 08', latestLedger: 1_500_000}, randomBytes))
      .toThrow('greater than zero');
  });
});

describe('randomness source', () => {
  it('refuses the insecure fallback when it is not allowed', () => {
    const original = (globalThis as {crypto?: unknown}).crypto;
    delete (globalThis as {crypto?: unknown}).crypto;
    try {
      expect(() => createRandomBytes({allowInsecureFallback: false})(32)).toThrow(RandomnessUnavailableError);
      expect(createRandomBytes({allowInsecureFallback: true})(32)).toHaveLength(32);
    } finally {
      (globalThis as {crypto?: unknown}).crypto = original;
    }
  });
});
