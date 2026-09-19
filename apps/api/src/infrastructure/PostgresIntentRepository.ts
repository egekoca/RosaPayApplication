import type {PaymentStatus} from '@rosapay/domain';
import {parseSignedPaymentIntent} from '@rosapay/protocol';
import type {PostgresQueryClient} from '@rosapay/postgres';
import {
  emptyPaymentMetrics,
  type AuthorizationRecord,
  type CountersignatureRecord,
  type IntentRepository,
  type MerchantPayment,
  type PaymentMetrics,
  type SettlementRecord,
  type StoredIntent,
} from '../application/IntentService';

export type {PostgresQueryClient, PostgresQueryResult} from '@rosapay/postgres';

type IntentRow = {
  intent_id: string;
  payload_hash: string;
  payload_json: unknown;
  idempotency_key: string;
  status: string;
};

type AuthorizationRow = {
  intent_id: string;
  authorizer: string;
  authorization_hash: string | null;
  expires_at_ledger: number | string | null;
  received_at: Date | string;
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

  async saveAuthorization(authorization: AuthorizationRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO authorizations (intent_id, authorizer, authorization_hash, expires_at_ledger, received_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (intent_id) DO UPDATE SET
         authorizer = EXCLUDED.authorizer,
         authorization_hash = EXCLUDED.authorization_hash,
         expires_at_ledger = EXCLUDED.expires_at_ledger,
         received_at = EXCLUDED.received_at`,
      [
        authorization.intentId,
        authorization.authorizer,
        authorization.authorizationHash ?? null,
        authorization.expiresAtLedger ?? null,
        authorization.receivedAt,
      ],
    );
  }

  async saveCountersignature(record: CountersignatureRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO merchant_countersignatures (intent_id, customer_address, signature, requested_at, signed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (intent_id) DO UPDATE SET
         signature = EXCLUDED.signature,
         signed_at = EXCLUDED.signed_at`,
      [
        record.intentId,
        record.customerAddress,
        record.signature ?? null,
        record.requestedAt,
        record.signedAt ?? null,
      ],
    );
  }

  async findCountersignature(intentId: string): Promise<CountersignatureRecord | null> {
    const result = await this.client.query<{
      intent_id: string;
      customer_address: string;
      signature: string | null;
      requested_at: Date | string;
      signed_at: Date | string | null;
    }>(
      `SELECT intent_id, customer_address, signature, requested_at, signed_at
         FROM merchant_countersignatures
        WHERE intent_id = $1`,
      [intentId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      intentId: row.intent_id,
      customerAddress: row.customer_address,
      ...(row.signature ? {signature: row.signature} : {}),
      requestedAt: toIsoString(row.requested_at),
      ...(row.signed_at ? {signedAt: toIsoString(row.signed_at)} : {}),
    };
  }

  async findAuthorization(intentId: string): Promise<AuthorizationRecord | null> {
    const result = await this.client.query<AuthorizationRow>(
      `SELECT intent_id, authorizer, authorization_hash, expires_at_ledger, received_at
         FROM authorizations
        WHERE intent_id = $1`,
      [intentId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const expiresAtLedger = row.expires_at_ledger === null ? undefined : Number(row.expires_at_ledger);
    if (expiresAtLedger !== undefined && (!Number.isSafeInteger(expiresAtLedger) || expiresAtLedger <= 0)) {
      throw new Error('Authorization expiry from PostgreSQL must be a positive safe integer');
    }
    return {
      intentId: row.intent_id,
      authorizer: row.authorizer,
      ...(row.authorization_hash === null ? {} : {authorizationHash: row.authorization_hash}),
      ...(expiresAtLedger === undefined ? {} : {expiresAtLedger}),
      receivedAt: toIsoString(row.received_at),
    };
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

  async readMetrics(): Promise<PaymentMetrics> {
    const metrics = emptyPaymentMetrics();

    const totals = await this.client.query<{intents: string}>(
      'SELECT count(*)::text AS intents FROM payment_intents',
    );
    metrics.intents = Number(totals.rows[0]?.intents ?? 0);

    const byStatus = await this.client.query<{status: PaymentStatus; total: string}>(
      'SELECT status, count(*)::text AS total FROM settlements GROUP BY status',
    );
    for (const row of byStatus.rows) {
      if (row.status in metrics.byStatus) metrics.byStatus[row.status] = Number(row.total);
    }

    // Both timestamps are the server's own: when it accepted the intent and
    // when it saw the transaction confirm.
    //
    // A payment cannot confirm before it was requested, so a row that says it
    // did is a clock artifact rather than a fast payment — rows that predate the
    // `created_at` column carry the migration's timestamp, which is later than
    // their confirmation. Those are unmeasurable and are left out instead of
    // being averaged in as negative time.
    const median = await this.client.query<{seconds: string | null}>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (s.confirmed_at - i.created_at))
              )::text AS seconds
         FROM settlements s
         JOIN payment_intents i ON i.intent_id = s.intent_id
        WHERE s.status = 'confirmed'
          AND s.confirmed_at IS NOT NULL
          AND s.confirmed_at >= i.created_at`,
    );
    const seconds = median.rows[0]?.seconds;
    metrics.medianConfirmationSeconds =
      seconds === null || seconds === undefined ? null : Math.round(Number(seconds) * 1000) / 1000;

    return metrics;
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

  async listMerchantPayments(merchantProfileId: string, limit: number): Promise<MerchantPayment[]> {
    const result = await this.client.query<{
      intent_id: string;
      payload_json: unknown;
      status: string | null;
      tx_hash: string | null;
      ledger: number | string | null;
      confirmed_at: Date | string | null;
    }>(
      `SELECT i.intent_id, i.payload_json, s.status, s.tx_hash, s.ledger, s.confirmed_at
         FROM payment_intents i
         LEFT JOIN settlements s ON s.intent_id = i.intent_id
        WHERE i.merchant_profile_id = $1
        ORDER BY i.id DESC
        LIMIT $2`,
      [merchantProfileId, limit],
    );

    return result.rows.map(row => {
      const payload = parseSignedPaymentIntent(
        typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json,
      );
      const status = row.status ?? 'created';
      if (!isPaymentStatus(status)) {
        throw new Error(`Unexpected settlement status from PostgreSQL: ${status}`);
      }
      const ledger = row.ledger === null ? undefined : Number(row.ledger);
      return {
        intentId: row.intent_id,
        amount: payload.intent.amount,
        assetCode: payload.intent.asset.code,
        reference: payload.intent.reference,
        createdAt: payload.intent.createdAt,
        status,
        ...(row.tx_hash === null ? {} : {transactionHash: row.tx_hash}),
        ...(ledger === undefined ? {} : {ledger}),
        ...(row.confirmed_at === null ? {} : {confirmedAt: toIsoString(row.confirmed_at)}),
      };
    });
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
