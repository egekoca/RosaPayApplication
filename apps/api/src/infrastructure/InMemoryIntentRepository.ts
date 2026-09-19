import type {IntentRepository, StoredIntent} from '../application/IntentService';

export class InMemoryIntentRepository implements IntentRepository {
  private readonly byId = new Map<string, StoredIntent>();
  private readonly byIdempotencyKey = new Map<string, StoredIntent>();

  async findByIntentId(intentId: string) {
    return this.byId.get(intentId) ?? null;
  }
  async findByIdempotencyKey(key: string) {
    return this.byIdempotencyKey.get(key) ?? null;
  }
  async save(intent: StoredIntent) {
    this.byId.set(intent.payload.intent.intentId, intent);
    this.byIdempotencyKey.set(intent.idempotencyKey, intent);
  }
}
