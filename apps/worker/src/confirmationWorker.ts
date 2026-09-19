import {StellarTransactionError} from '@rosapay/stellar';

export type SubmittedSettlement = {
  intentId: string;
  transactionHash: string;
};

export type SettlementConfirmationState = {
  listSubmittedSettlements(): Promise<ReadonlyArray<SubmittedSettlement>>;
  confirm(intentId: string, transactionHash: string, ledger: number): Promise<unknown>;
  fail(intentId: string, failureCode: string): Promise<unknown>;
};

export type TransactionConfirmation = {
  txHash: string;
  ledger: number;
};

export type TransactionConfirmationRpc = {
  confirmTransaction(hash: string): Promise<TransactionConfirmation>;
};

export type ConfirmationSummary = {
  scanned: number;
  confirmed: number;
  failed: number;
  pending: number;
};

export type ConfirmationLoop = {
  start(): void;
  stop(): void;
};

/**
 * Reconciles submitted payments without coupling the worker to the API process.
 * The state port can be backed by the in-memory service today and a durable
 * repository/HTTP adapter later.
 */
export async function confirmSubmittedSettlements(input: {
  state: SettlementConfirmationState;
  rpc: TransactionConfirmationRpc;
}): Promise<ConfirmationSummary> {
  const submitted = await input.state.listSubmittedSettlements();
  const summary: ConfirmationSummary = {
    scanned: submitted.length,
    confirmed: 0,
    failed: 0,
    pending: 0,
  };

  for (const settlement of submitted) {
    let receipt: TransactionConfirmation;
    try {
      receipt = await input.rpc.confirmTransaction(settlement.transactionHash);
    } catch (error) {
      if (error instanceof StellarTransactionError && error.code === 'NOT_FOUND') {
        summary.pending += 1;
        continue;
      }

      const code = error instanceof StellarTransactionError ? error.code : 'UNKNOWN';
      await input.state.fail(settlement.intentId, `STELLAR_${code}`);
      summary.failed += 1;
      continue;
    }

    if (receipt.txHash.toLowerCase() !== settlement.transactionHash.toLowerCase()) {
      await input.state.fail(settlement.intentId, 'STELLAR_INVALID_SUCCESS_RESPONSE');
      summary.failed += 1;
      continue;
    }

    await input.state.confirm(settlement.intentId, receipt.txHash, receipt.ledger);
    summary.confirmed += 1;
  }

  return summary;
}

/** Runs reconciliation on a bounded interval and never overlaps cycles. */
export function createConfirmationLoop(input: {
  run: () => Promise<unknown>;
  intervalMs: number;
  onError?: (error: unknown) => void;
}): ConfirmationLoop {
  if (!Number.isFinite(input.intervalMs) || input.intervalMs <= 0) {
    throw new Error('Confirmation interval must be a positive number');
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await input.run();
    } catch (error) {
      input.onError?.(error);
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), input.intervalMs);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
