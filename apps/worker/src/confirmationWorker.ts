import {StellarTransactionError, type SettlementEvent, type SettlementEventPage} from '@rosapay/stellar';

export type SubmittedSettlement = {
  intentId: string;
  transactionHash: string;
};

export type ExpirableSettlement = {
  intentId: string;
  expiresAtLedger: number;
};

export type SettlementConfirmationState = {
  listSubmittedSettlements(): Promise<ReadonlyArray<SubmittedSettlement>>;
  confirm(intentId: string, transactionHash: string, ledger: number): Promise<unknown>;
  fail(intentId: string, failureCode: string): Promise<unknown>;
  /** Payments still waiting for a customer once their expiry ledger has passed. */
  listExpiredSettlements?(latestLedger: number): Promise<ReadonlyArray<ExpirableSettlement>>;
  expire?(intentId: string): Promise<unknown>;
};

export type ExpirySummary = {
  scanned: number;
  expired: number;
};

/**
 * Closes out payments nobody completed. Without this a request that was never
 * paid stays pending forever, and a merchant cannot tell the difference between
 * "still waiting" and "will never happen".
 */
export async function expireStaleSettlements(input: {
  state: SettlementConfirmationState;
  latestLedger: number;
}): Promise<ExpirySummary> {
  if (!input.state.listExpiredSettlements || !input.state.expire) {
    return {scanned: 0, expired: 0};
  }

  const stale = await input.state.listExpiredSettlements(input.latestLedger);
  let expired = 0;
  for (const settlement of stale) {
    if (settlement.expiresAtLedger > input.latestLedger) continue;
    await input.state.expire(settlement.intentId);
    expired += 1;
  }
  return {scanned: stale.length, expired};
}

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

export type EventConfirmationSummary = {
  scanned: number;
  confirmed: number;
  failed: number;
  pending: number;
  ignored: number;
};

export type EventCursor = {
  cursor: string;
  startLedger: number;
};

export type EventCursorStore = {
  load(): Promise<EventCursor | null>;
  save(cursor: EventCursor): Promise<void>;
};

export type SettlementEventSource = {
  getSettlementEvents(input: {
    startLedger?: number;
    cursor?: string;
    limit?: number;
  }): Promise<SettlementEventPage>;
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

/**
 * Reconciles contract events against submitted API records. Events are an
 * audit/recovery signal; the transaction receipt is still checked before the
 * API is allowed to enter `confirmed`.
 */
export async function reconcileSettlementEvents(input: {
  state: SettlementConfirmationState;
  rpc: TransactionConfirmationRpc;
  events: ReadonlyArray<Pick<SettlementEvent, 'intentId' | 'transactionHash' | 'ledger'>>;
}): Promise<EventConfirmationSummary> {
  const submitted = await input.state.listSubmittedSettlements();
  const byIntentId = new Map(submitted.map(settlement => [settlement.intentId, settlement]));
  const seen = new Set<string>();
  const summary: EventConfirmationSummary = {
    scanned: input.events.length,
    confirmed: 0,
    failed: 0,
    pending: 0,
    ignored: 0,
  };

  for (const event of input.events) {
    if (seen.has(event.intentId)) {
      summary.ignored += 1;
      continue;
    }
    seen.add(event.intentId);

    const settlement = byIntentId.get(event.intentId);
    if (!settlement) {
      summary.ignored += 1;
      continue;
    }
    if (settlement.transactionHash.toLowerCase() !== event.transactionHash.toLowerCase()) {
      await input.state.fail(settlement.intentId, 'STELLAR_EVENT_TX_MISMATCH');
      summary.failed += 1;
      continue;
    }

    let receipt: TransactionConfirmation;
    try {
      receipt = await input.rpc.confirmTransaction(event.transactionHash);
    } catch (error) {
      if (error instanceof StellarTransactionError && error.code === 'NOT_FOUND') {
        summary.pending += 1;
        continue;
      }
      const code = error instanceof StellarTransactionError ? error.code : 'UNKNOWN';
      await input.state.fail(settlement.intentId, `STELLAR_EVENT_${code}`);
      summary.failed += 1;
      continue;
    }

    if (
      receipt.txHash.toLowerCase() !== event.transactionHash.toLowerCase() ||
      receipt.ledger !== event.ledger
    ) {
      await input.state.fail(settlement.intentId, 'STELLAR_EVENT_RECEIPT_MISMATCH');
      summary.failed += 1;
      continue;
    }

    await input.state.confirm(settlement.intentId, receipt.txHash, receipt.ledger);
    summary.confirmed += 1;
  }

  return summary;
}

/** Reads one RPC event page, reconciles it, then advances the cursor. */
export async function reconcileSettlementEventPage(input: {
  state: SettlementConfirmationState;
  rpc: TransactionConfirmationRpc;
  source: SettlementEventSource;
  cursorStore: EventCursorStore;
  startLedger: number;
  limit?: number;
}): Promise<EventConfirmationSummary & {cursor: string; latestLedger: number}> {
  const checkpoint = await input.cursorStore.load();
  const page = checkpoint?.cursor
    ? await input.source.getSettlementEvents({cursor: checkpoint.cursor, ...(input.limit === undefined ? {} : {limit: input.limit})})
    : await input.source.getSettlementEvents({startLedger: input.startLedger, ...(input.limit === undefined ? {} : {limit: input.limit})});
  const summary = await reconcileSettlementEvents({state: input.state, rpc: input.rpc, events: page.events});
  await input.cursorStore.save({cursor: page.cursor, startLedger: page.latestLedger});
  return {...summary, cursor: page.cursor, latestLedger: page.latestLedger};
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
