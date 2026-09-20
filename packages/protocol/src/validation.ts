import {
  paymentIntentV1Schema,
  signedPaymentIntentV1Schema,
  type PaymentIntentV1,
  type SignedPaymentIntentV1,
} from './schema';

export type IntentValidationContext = {
  network: PaymentIntentV1['network'];
  /**
   * Where the chain is now, when the caller can know it.
   *
   * A phone in airplane mode cannot read a ledger, and refusing to look at a
   * request for want of one would make an offline payment impossible at the
   * only moment it matters. Left out, the expiry checks below are skipped and
   * nothing else is: the network and the schema are still enforced, the
   * merchant that submits checks the expiry against a live ledger, and the
   * contract checks it again before it moves anything.
   */
  latestLedger?: number;
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
  if (context.latestLedger === undefined) return intent;

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
