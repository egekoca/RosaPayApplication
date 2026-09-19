import {hashPaymentIntent, parseSignedPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';

export type StoredIntent = {
  payload: SignedPaymentIntentV1;
  payloadHash: string;
  idempotencyKey: string;
  status: 'created';
};

export interface IntentRepository {
  findByIntentId(intentId: string): Promise<StoredIntent | null>;
  findByIdempotencyKey(key: string): Promise<StoredIntent | null>;
  save(intent: StoredIntent): Promise<void>;
}

export class IntentConflictError extends Error {}

export class IntentService {
  constructor(private readonly repository: IntentRepository) {}

  async create(input: unknown, idempotencyKey: string): Promise<StoredIntent> {
    const payload = parseSignedPaymentIntent(input);
    const payloadHash = hashPaymentIntent(payload.intent);
    const previous = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new IntentConflictError('Idempotency key already used for a different intent');
      }
      return previous;
    }

    if (await this.repository.findByIntentId(payload.intent.intentId)) {
      throw new IntentConflictError('Intent ID already exists');
    }

    const stored: StoredIntent = {
      payload,
      payloadHash,
      idempotencyKey,
      status: 'created',
    };
    await this.repository.save(stored);
    return stored;
  }

  get(intentId: string) {
    return this.repository.findByIntentId(intentId);
  }
}
