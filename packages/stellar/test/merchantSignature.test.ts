import {getPublicKey, hashes, sign, utils} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {hashPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {StrKey} from '@stellar/stellar-sdk';
import {Base64} from 'js-base64';
import {describe, expect, it} from 'vitest';
import {verifyMerchantSignature} from '../src';

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
