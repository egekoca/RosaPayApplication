import {getPublicKey, hashes, sign, verify} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {
  hashPaymentIntent,
  parseSignedPaymentIntent,
  paymentIntentV1Schema,
  type SignedPaymentIntentV1,
} from '@rosapay/protocol';
import {StrKey} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';
import {Base64} from 'js-base64';

hashes.sha512 = sha512;

/**
 * Signs the RTP/1 intent hash with a merchant Ed25519 secret. The key belongs to
 * the merchant's own signer, never to a customer wallet: this is the request the
 * customer verifies before authorizing anything.
 */
export function signMerchantIntent(intent: unknown, secretKey: Uint8Array): string {
  if (secretKey.length !== 32) {
    throw new Error('A merchant Ed25519 secret key must be 32 bytes');
  }
  const message = hexToBytes(hashPaymentIntent(paymentIntentV1Schema.parse(intent)));
  return Base64.fromUint8Array(sign(message, secretKey));
}

/** Derives the Stellar G-address that a merchant secret key publishes as its signing key. */
export function merchantSigningKeyFromSecret(secretKey: Uint8Array): string {
  if (secretKey.length !== 32) {
    throw new Error('A merchant Ed25519 secret key must be 32 bytes');
  }
  return StrKey.encodeEd25519PublicKey(Buffer.from(getPublicKey(secretKey)));
}

export function verifyMerchantSignature(input: unknown): input is SignedPaymentIntentV1 {
  try {
    const payload = parseSignedPaymentIntent(input);
    const publicKey = StrKey.decodeEd25519PublicKey(payload.intent.merchantSigningKey);
    const signature = Base64.toUint8Array(payload.signature);
    const message = hexToBytes(hashPaymentIntent(payload.intent));
    return verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
