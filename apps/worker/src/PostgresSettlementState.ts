import {transitionPayment, type Payment, type PaymentStatus} from '@rosapay/domain';
import type {PostgresQueryClient} from '@rosapay/postgres';
import type {SettlementConfirmationState, SubmittedSettlement} from './confirmationWorker';

type SettlementRow = {
  intent_id: string;
  status: string;
  tx_hash: string | null;
};

export class SettlementStateError extends Error {}

/**
 * Reconciles settlement rows the API owns. Every write re-reads the current row
 * and replays the domain transition guard, and the UPDATE is conditional on that
 * status so a concurrent API write can never be overwritten.
 */
export class PostgresSettlementState implements SettlementConfirmationState {
  constructor(private readonly client: PostgresQueryClient) {}

  async listSubmittedSettlements(): Promise<ReadonlyArray<SubmittedSettlement>> {
    const result = await this.client.query<SettlementRow>(
      `SELECT intent_id, status, tx_hash
         FROM settlements
        WHERE status = 'submitted' AND tx_hash IS NOT NULL
        ORDER BY intent_id`,
    );
    return result.rows.map(row => {
      if (!isTransactionHash(row.tx_hash)) {
        throw new SettlementStateError(`Submitted settlement ${row.intent_id} has an invalid transaction hash`);
      }
      return {intentId: row.intent_id, transactionHash: row.tx_hash};
    });
  }

  async confirm(intentId: string, transactionHash: string, ledger: number): Promise<void> {
    if (!isTransactionHash(transactionHash)) {
      throw new SettlementStateError('Transaction hash must be a 64-character hexadecimal value');
    }
    if (!Number.isSafeInteger(ledger) || ledger <= 0) {
      throw new SettlementStateError('A positive ledger sequence is required');
    }
    const current = await this.requireCurrent(intentId);
    if (current.status === 'confirmed') {
      if (current.transactionHash && current.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) {
        throw new SettlementStateError(`Settlement ${intentId} is already confirmed with a different transaction`);
      }
      return;
    }
    if (current.transactionHash && current.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) {
      throw new SettlementStateError(`Settlement ${intentId} cannot change its transaction hash`);
    }
    this.assertTransition(current, 'confirmed');

    await this.applyUpdate(
      `UPDATE settlements
          SET status = 'confirmed', tx_hash = $2, ledger = $3, confirmed_at = now()
        WHERE intent_id = $1 AND status = $4
        RETURNING intent_id`,
      [intentId, transactionHash, ledger, current.status],
      intentId,
    );
  }

  async fail(intentId: string, failureCode: string): Promise<void> {
    const code = failureCode.trim();
    if (!code) throw new SettlementStateError('A failure code is required');
    const current = await this.requireCurrent(intentId);
    if (current.status === 'failed') return;
    this.assertTransition(current, 'failed');

    await this.applyUpdate(
      `UPDATE settlements
          SET status = 'failed', failure_code = $2
        WHERE intent_id = $1 AND status = $3
        RETURNING intent_id`,
      [intentId, code, current.status],
      intentId,
    );
  }

  private async requireCurrent(intentId: string): Promise<Payment> {
    const result = await this.client.query<SettlementRow>(
      `SELECT intent_id, status, tx_hash FROM settlements WHERE intent_id = $1`,
      [intentId],
    );
    const row = result.rows[0];
    if (!row) throw new SettlementStateError(`Settlement ${intentId} was not found`);
    if (!isPaymentStatus(row.status)) {
      throw new SettlementStateError(`Unexpected settlement status from PostgreSQL: ${row.status}`);
    }
    return {
      intentId: row.intent_id,
      status: row.status,
      ...(row.tx_hash === null ? {} : {transactionHash: row.tx_hash}),
    };
  }

  private assertTransition(current: Payment, next: PaymentStatus): void {
    try {
      transitionPayment(current, next);
    } catch (error) {
      throw new SettlementStateError(error instanceof Error ? error.message : 'Invalid settlement transition');
    }
  }

  private async applyUpdate(text: string, values: readonly unknown[], intentId: string): Promise<void> {
    const result = await this.client.query<{intent_id: string}>(text, values);
    if (result.rows.length === 0) {
      throw new SettlementStateError(`Settlement ${intentId} changed while it was being reconciled`);
    }
  }
}

function isTransactionHash(value: string | null): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isPaymentStatus(value: string): value is PaymentStatus {
  return ['created', 'awaiting_approval', 'authorized', 'submitted', 'confirmed', 'rejected', 'expired', 'failed'].includes(value);
}
