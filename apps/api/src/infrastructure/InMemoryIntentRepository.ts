import type {IntentRepository, SettlementRecord, StoredIntent} from '../application/IntentService';

export class InMemoryIntentRepository implements IntentRepository {
  private readonly byId = new Map<string, StoredIntent>();
  private readonly byIdempotencyKey = new Map<string, StoredIntent>();
  private readonly settlements = new Map<string, SettlementRecord>();

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

  async findSettlement(intentId: string) {
    return this.settlements.get(intentId) ?? null;
  }

  async saveSettlement(settlement: SettlementRecord) {
    this.settlements.set(settlement.intentId, settlement);
  }
}
