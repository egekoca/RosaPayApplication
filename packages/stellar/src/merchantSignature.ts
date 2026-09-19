import {hashes, verify} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {hashPaymentIntent, parseSignedPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {StrKey} from '@stellar/stellar-sdk';
import {Base64} from 'js-base64';

hashes.sha512 = sha512;

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
