import {
  paymentIntentV1Schema,
  signedPaymentIntentV1Schema,
  type PaymentIntentV1,
  type SignedPaymentIntentV1,
} from './schema';

export type IntentValidationContext = {
  network: PaymentIntentV1['network'];
  latestLedger: number;
  maxLedgerLifetime?: number;
};

export class IntentPolicyError extends Error {
  constructor(
    public readonly code: 'WRONG_NETWORK' | 'EXPIRED' | 'EXPIRY_TOO_FAR',
    message: string,
  ) {
    super(message);
    this.name = 'IntentPolicyError';
  }
}

export function validatePaymentIntent(
  input: unknown,
  context: IntentValidationContext,
): PaymentIntentV1 {
  const intent = paymentIntentV1Schema.parse(input);

  if (intent.network !== context.network) {
    throw new IntentPolicyError('WRONG_NETWORK', `Intent targets ${intent.network}`);
  }
  if (intent.expiresAtLedger <= context.latestLedger) {
    throw new IntentPolicyError('EXPIRED', 'Payment request has expired');
  }
  if (
    context.maxLedgerLifetime !== undefined &&
    intent.expiresAtLedger - context.latestLedger > context.maxLedgerLifetime
  ) {
    throw new IntentPolicyError('EXPIRY_TOO_FAR', 'Payment request lifetime exceeds policy');
  }

  return intent;
}

export function parseSignedPaymentIntent(input: unknown): SignedPaymentIntentV1 {
  return signedPaymentIntentV1Schema.parse(input);
}
