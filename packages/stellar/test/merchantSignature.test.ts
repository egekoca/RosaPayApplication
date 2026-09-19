import {getPublicKey, hashes, sign, utils} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {createPaymentIntent, hashPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {StrKey} from '@stellar/stellar-sdk';
import {Base64} from 'js-base64';
import {describe, expect, it} from 'vitest';
import {merchantSigningKeyFromSecret, signMerchantIntent, verifyMerchantSignature} from '../src';

hashes.sha512 = sha512;

const secret = utils.randomSecretKey();
const publicKey = getPublicKey(secret);

function signedPayload(amount = '24.5'): SignedPaymentIntentV1 {
  const intent: SignedPaymentIntentV1['intent'] = {
    version: 'RTP/1',
    intentId: '01K36YB37NXM4X4TECF0VKP1M9',
    network: 'testnet',
    merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
    merchantName: 'Rose Coffee',
    merchantSigningKey: StrKey.encodeEd25519PublicKey(Buffer.from(publicKey)),
    recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    asset: {type: 'native', code: 'XLM', decimals: 7},
    amount,
    reference: 'Table 08',
    nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
    expiresAtLedger: 1_500_120,
    createdAt: '2026-08-21T00:00:00.000Z',
  };
  const signature = sign(hexToBytes(hashPaymentIntent(intent)), secret);
  return {intent, signature: Base64.fromUint8Array(signature)};
}

describe('merchant signature verification', () => {
  it('accepts a signature over the canonical RTP/1 hash', () => {
    expect(verifyMerchantSignature(signedPayload())).toBe(true);
  });

  it('rejects amount tampering', () => {
    const payload = signedPayload();
    payload.intent.amount = '25';
    expect(verifyMerchantSignature(payload)).toBe(false);
  });
});

describe('merchant intent signing', () => {
  const secretKey = new Uint8Array(32).fill(7);

  it('signs an intent that verification then accepts', () => {
    const intent = createPaymentIntent({
      profile: {
        merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
        merchantName: 'Rose Coffee',
        merchantSigningKey: merchantSigningKeyFromSecret(secretKey),
        recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        network: 'testnet',
      },
      amount: '24.5',
      reference: 'Table 08',
      latestLedger: 1_500_000,
      intentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
      createdAt: '2026-08-23T00:00:00.000Z',
    });

    const payload = {intent, signature: signMerchantIntent(intent, secretKey)};
    expect(verifyMerchantSignature(payload)).toBe(true);
    expect(verifyMerchantSignature({...payload, intent: {...intent, amount: '25'}})).toBe(false);
  });

  it('derives a Stellar G-address and rejects a wrong-sized secret', () => {
    expect(merchantSigningKeyFromSecret(secretKey)).toMatch(/^G[A-Z2-7]{55}$/);
    expect(() => signMerchantIntent({}, new Uint8Array(16))).toThrow('must be 32 bytes');
    expect(() => merchantSigningKeyFromSecret(new Uint8Array(16))).toThrow('must be 32 bytes');
  });
});
