import type {IntentRepository, SettlementRecord, StoredIntent} from '../application/IntentService';
import type {PaymentStatus} from '@rosapay/domain';

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

  async saveIntentWithSettlement(intent: StoredIntent, settlement: SettlementRecord) {
    await this.save(intent);
    await this.saveSettlement(settlement);
  }

  async findSettlement(intentId: string) {
    return this.settlements.get(intentId) ?? null;
  }

  async listSettlements(status?: PaymentStatus) {
    const settlements = [...this.settlements.values()];
    return status ? settlements.filter(settlement => settlement.status === status) : settlements;
  }

  async saveSettlement(settlement: SettlementRecord) {
    this.settlements.set(settlement.intentId, settlement);
  }
}
