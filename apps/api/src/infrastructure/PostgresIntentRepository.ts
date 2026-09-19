import type {PaymentStatus} from '@rosapay/domain';
import {parseSignedPaymentIntent} from '@rosapay/protocol';
import type {
  IntentRepository,
  SettlementRecord,
  StoredIntent,
} from '../application/IntentService';

export type PostgresQueryResult<Row> = {rows: Row[]};

/** Small driver-neutral port; the production app can inject `pg.Pool`. */
export type PostgresQueryClient = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  /** The production adapter should implement this with a database transaction. */
  withTransaction?<T>(work: (client: PostgresQueryClient) => Promise<T>): Promise<T>;
};

type IntentRow = {
  intent_id: string;
  payload_hash: string;
  payload_json: unknown;
  idempotency_key: string;
  status: string;
};

type SettlementRow = {
  intent_id: string;
  status: string;
  tx_hash: string | null;
  ledger: number | string | null;
  failure_code: string | null;
  confirmed_at: Date | string | null;
};

export class PostgresIntentRepository implements IntentRepository {
  constructor(private readonly client: PostgresQueryClient) {}

  async findByIntentId(intentId: string): Promise<StoredIntent | null> {
    const result = await this.client.query<IntentRow>(
      `SELECT intent_id, payload_hash, payload_json, idempotency_key, status
         FROM payment_intents
        WHERE intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  async findByIdempotencyKey(key: string): Promise<StoredIntent | null> {
    const result = await this.client.query<IntentRow>(
      `SELECT intent_id, payload_hash, payload_json, idempotency_key, status
         FROM payment_intents
        WHERE idempotency_key = $1`,
      [key],
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  async save(intent: StoredIntent): Promise<void> {
    await this.client.query(
      `INSERT INTO payment_intents
        (intent_id, merchant_profile_id, payload_hash, payload_json, status, expires_at_ledger, idempotency_key)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [
        intent.payload.intent.intentId,
        intent.payload.intent.merchantProfileId,
        intent.payloadHash,
        JSON.stringify(intent.payload),
        intent.status,
        intent.payload.intent.expiresAtLedger,
        intent.idempotencyKey,
      ],
    );
  }

  async saveIntentWithSettlement(intent: StoredIntent, settlement: SettlementRecord): Promise<void> {
    const persist = async (client: PostgresQueryClient) => {
      const repository = client === this.client ? this : new PostgresIntentRepository(client);
      await repository.save(intent);
      await repository.saveSettlement(settlement);
    };
    if (this.client.withTransaction) {
      await this.client.withTransaction(persist);
      return;
    }
    // Driver-neutral tests and local adapters may not expose transactions.
    await persist(this.client);
  }

  async findSettlement(intentId: string): Promise<SettlementRecord | null> {
    const result = await this.client.query<SettlementRow>(
      `SELECT intent_id, status, tx_hash, ledger, failure_code, confirmed_at
         FROM settlements
        WHERE intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapSettlement(result.rows[0]) : null;
  }

  async listSettlements(status?: PaymentStatus): Promise<SettlementRecord[]> {
    const result = status
      ? await this.client.query<SettlementRow>(
          `SELECT intent_id, status, tx_hash, ledger, failure_code, confirmed_at
             FROM settlements
            WHERE status = $1
            ORDER BY intent_id`,
          [status],
        )
      : await this.client.query<SettlementRow>(
          `SELECT intent_id, status, tx_hash, ledger, failure_code, confirmed_at
             FROM settlements
            ORDER BY intent_id`,
        );
    return result.rows.map(mapSettlement);
  }

  async saveSettlement(settlement: SettlementRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO settlements
        (intent_id, tx_hash, ledger, status, failure_code, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (intent_id) DO UPDATE SET
        tx_hash = EXCLUDED.tx_hash,
        ledger = EXCLUDED.ledger,
        status = EXCLUDED.status,
        failure_code = EXCLUDED.failure_code,
        confirmed_at = EXCLUDED.confirmed_at`,
      [
        settlement.intentId,
        settlement.transactionHash ?? null,
        settlement.ledger ?? null,
        settlement.status,
        settlement.failureCode ?? null,
        settlement.confirmedAt ?? null,
      ],
    );
  }
}

function mapIntent(row: IntentRow): StoredIntent {
  if (row.status !== 'created') {
    throw new Error(`Unexpected payment intent status from PostgreSQL: ${row.status}`);
  }
  const payload = parseSignedPaymentIntent(
    typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json,
  );
  return {
    payload,
    payloadHash: row.payload_hash,
    idempotencyKey: row.idempotency_key,
    status: row.status as StoredIntent['status'],
  };
}

function mapSettlement(row: SettlementRow): SettlementRecord {
  if (!isPaymentStatus(row.status)) {
    throw new Error(`Unexpected settlement status from PostgreSQL: ${row.status}`);
  }
  const ledger = row.ledger === null ? undefined : Number(row.ledger);
  if (ledger !== undefined && (!Number.isSafeInteger(ledger) || ledger <= 0)) {
    throw new Error('Settlement ledger from PostgreSQL must be a positive safe integer');
  }
  return {
    intentId: row.intent_id,
    status: row.status as PaymentStatus,
    ...(row.tx_hash === null ? {} : {transactionHash: row.tx_hash}),
    ...(ledger === undefined ? {} : {ledger}),
    ...(row.failure_code === null ? {} : {failureCode: row.failure_code}),
    ...(row.confirmed_at === null ? {} : {confirmedAt: toIsoString(row.confirmed_at)}),
  };
}

function isPaymentStatus(value: string): value is PaymentStatus {
  return ['created', 'awaiting_approval', 'authorized', 'submitted', 'confirmed', 'rejected', 'expired', 'failed'].includes(value);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
