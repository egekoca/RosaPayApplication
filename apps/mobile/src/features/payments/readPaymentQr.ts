import {decodePaymentQr, validatePaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {verifyMerchantSignature} from '@rosapay/stellar/merchant-signature';

export type ScanContext = {
  network: 'testnet' | 'pubnet';
  latestLedger: number;
  maxLedgerLifetime: number;
};

export type ScanResult =
  | {ok: true; payload: SignedPaymentIntentV1}
  | {ok: false; message: string};

/**
 * Turns whatever the camera saw into either a payment to confirm or a message a
 * customer can act on. A scanner points at the world, so most reads are not
 * payment requests at all; none of that is exceptional, and the screen has to
 * stay pointed at the frame rather than fall over.
 */
export function readPaymentQr(value: string, context: ScanContext): ScanResult {
  let payload: SignedPaymentIntentV1;
  try {
    payload = decodePaymentQr(value);
  } catch (error) {
    return {ok: false, message: messageFor(error, 'This code is not a Lumenade Pay payment request')};
  }

  try {
    validatePaymentIntent(payload.intent, {
      network: context.network,
      latestLedger: context.latestLedger,
      maxLedgerLifetime: context.maxLedgerLifetime,
    });
  } catch (error) {
    return {ok: false, message: messageFor(error, 'This payment request is not valid')};
  }

  if (!verifyMerchantSignature(payload)) {
    return {ok: false, message: 'This request was not signed by the merchant it names'};
  }

  return {ok: true, payload};
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
