import {
  createIntentIdentifiers,
  createPaymentIntent,
  type PaymentIntentV1,
  type RandomBytes,
  type SignedPaymentIntentV1,
} from '@rosapay/protocol';
import {isValidStellarAddress} from '@rosapay/stellar';
import {merchantSigningKeyFromSecret, signMerchantIntent} from '@rosapay/stellar/merchant-signature';

export type MerchantProfileDraft = {
  displayName: string;
  recipient: string;
};

export type MerchantProfile = {
  merchantProfileId: string;
  displayName: string;
  recipient: string;
  signingKey: string;
  network: PaymentIntentV1['network'];
  /**
   * Demo-only Ed25519 secret used to sign RTP/1 requests until the native
   * merchant signer exists. It never leaves memory, never signs a settlement
   * transaction, and the Testnet path refuses to use it.
   */
  developmentSigningSecret: Uint8Array;
};

export class MerchantProfileError extends Error {
  override readonly name = 'MerchantProfileError';

  constructor(readonly field: 'displayName' | 'recipient' | 'amount' | 'reference' | 'ledger', message: string) {
    super(message);
  }
}

/** Creates the local merchant identity that signs payment requests. */
export function createMerchantProfile(
  draft: MerchantProfileDraft,
  randomBytes: RandomBytes,
  network: PaymentIntentV1['network'] = 'testnet',
): MerchantProfile {
  const displayName = draft.displayName.trim();
  const recipient = draft.recipient.trim().toUpperCase();
  if (displayName.length < 1 || displayName.length > 80) {
    throw new MerchantProfileError('displayName', 'Enter a business name of up to 80 characters');
  }
  if (!isValidStellarAddress(recipient)) {
    throw new MerchantProfileError('recipient', 'Enter a valid Stellar address (starts with G or C)');
  }

  const developmentSigningSecret = randomBytes(32);
  const {intentId} = createIntentIdentifiers(randomBytes);
  return {
    merchantProfileId: intentId,
    displayName,
    recipient,
    signingKey: merchantSigningKeyFromSecret(developmentSigningSecret),
    network,
    developmentSigningSecret,
  };
}

export type PaymentRequestDraft = {
  amount: string;
  reference: string;
  latestLedger: number | undefined;
  lifetimeLedgers?: number;
};

/**
 * Builds and signs a real RTP/1 request from merchant data. The customer path
 * verifies this signature, so the QR is no longer a fixture.
 */
export function createSignedPaymentRequest(
  profile: MerchantProfile,
  draft: PaymentRequestDraft,
  randomBytes: RandomBytes,
  now: Date = new Date(),
): SignedPaymentIntentV1 {
  if (draft.latestLedger === undefined) {
    throw new MerchantProfileError('ledger', 'Stellar Testnet is unavailable, so the expiry cannot be set');
  }
  if (!draft.reference.trim()) {
    throw new MerchantProfileError('reference', 'Add a short reference such as a table or order number');
  }

  const identifiers = createIntentIdentifiers(randomBytes);
  const intent = createPaymentIntent({
    profile: {
      merchantProfileId: profile.merchantProfileId,
      merchantName: profile.displayName,
      merchantSigningKey: profile.signingKey,
      recipient: profile.recipient,
      network: profile.network,
    },
    amount: draft.amount,
    reference: draft.reference,
    latestLedger: draft.latestLedger,
    ...(draft.lifetimeLedgers === undefined ? {} : {lifetimeLedgers: draft.lifetimeLedgers}),
    ...identifiers,
    createdAt: now.toISOString(),
  });

  return {intent, signature: signMerchantIntent(intent, profile.developmentSigningSecret)};
}
