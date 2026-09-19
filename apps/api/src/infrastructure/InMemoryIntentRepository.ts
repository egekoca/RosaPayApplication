import type {
  AuthorizationRecord,
  IntentRepository,
  SettlementRecord,
  StoredIntent,
} from '../application/IntentService';
import type {PaymentStatus} from '@rosapay/domain';

export class InMemoryIntentRepository implements IntentRepository {
  private readonly byId = new Map<string, StoredIntent>();
  private readonly byIdempotencyKey = new Map<string, StoredIntent>();
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly authorizations = new Map<string, AuthorizationRecord>();

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

  async saveAuthorization(authorization: AuthorizationRecord) {
    this.authorizations.set(authorization.intentId, authorization);
  }

  async findAuthorization(intentId: string) {
    return this.authorizations.get(intentId) ?? null;
  }

  async saveSettlement(settlement: SettlementRecord) {
    this.settlements.set(settlement.intentId, settlement);
  }
}
