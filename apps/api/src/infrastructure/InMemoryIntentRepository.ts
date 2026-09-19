import {
  emptyPaymentMetrics,
  type AuthorizationRecord,
  type MerchantPayment,
  type IntentRepository,
  type PaymentMetrics,
  type SettlementRecord,
  type StoredIntent,
} from '../application/IntentService';
import type {PaymentStatus} from '@rosapay/domain';

export class InMemoryIntentRepository implements IntentRepository {
  private readonly byId = new Map<string, StoredIntent>();
  private readonly byIdempotencyKey = new Map<string, StoredIntent>();
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly authorizations = new Map<string, AuthorizationRecord>();
  /** When this process saw each intent, so timings are not a client's clock. */
  private readonly createdAt = new Map<string, number>();

  async findByIntentId(intentId: string) {
    return this.byId.get(intentId) ?? null;
  }
  async findByIdempotencyKey(key: string) {
    return this.byIdempotencyKey.get(key) ?? null;
  }
  async save(intent: StoredIntent) {
    const intentId = intent.payload.intent.intentId;
    this.byId.set(intentId, intent);
    this.byIdempotencyKey.set(intent.idempotencyKey, intent);
    if (!this.createdAt.has(intentId)) this.createdAt.set(intentId, Date.now());
  }

  async readMetrics(): Promise<PaymentMetrics> {
    const metrics = emptyPaymentMetrics();
    metrics.intents = this.byId.size;

    const durations: number[] = [];
    for (const settlement of this.settlements.values()) {
      metrics.byStatus[settlement.status] += 1;
      const created = this.createdAt.get(settlement.intentId);
      if (settlement.status === 'confirmed' && settlement.confirmedAt && created !== undefined) {
        const seconds = (Date.parse(settlement.confirmedAt) - created) / 1000;
        // A payment cannot confirm before it was requested; a row that says it
        // did is a clock artifact, not a measurement.
        if (seconds >= 0) durations.push(seconds);
      }
    }

    metrics.medianConfirmationSeconds = median(durations);
    return metrics;
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

  async listMerchantPayments(merchantProfileId: string, limit: number): Promise<MerchantPayment[]> {
    return [...this.byId.values()]
      .filter(intent => intent.payload.intent.merchantProfileId === merchantProfileId)
      .sort((left, right) => right.payload.intent.createdAt.localeCompare(left.payload.intent.createdAt))
      .slice(0, limit)
      .map(intent => {
        const settlement = this.settlements.get(intent.payload.intent.intentId);
        return {
          intentId: intent.payload.intent.intentId,
          amount: intent.payload.intent.amount,
          assetCode: intent.payload.intent.asset.code,
          reference: intent.payload.intent.reference,
          createdAt: intent.payload.intent.createdAt,
          status: settlement?.status ?? 'created',
          ...(settlement?.transactionHash ? {transactionHash: settlement.transactionHash} : {}),
          ...(settlement?.ledger === undefined ? {} : {ledger: settlement.ledger}),
          ...(settlement?.confirmedAt ? {confirmedAt: settlement.confirmedAt} : {}),
        };
      });
  }

  async saveSettlement(settlement: SettlementRecord) {
    this.settlements.set(settlement.intentId, settlement);
  }
}

/** The middle value, averaging the two middles when the count is even. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(value * 1000) / 1000;
}
