import {
  confirmSubmittedSettlements,
  expireStaleSettlements,
  reconcileSettlementEventPage,
  type EventCursorStore,
  type SettlementConfirmationState,
  type SettlementEventSource,
  type TransactionConfirmationRpc,
} from './confirmationWorker';

export type WorkerLog = (entry: Record<string, unknown>) => void;

export type WorkerConfig = {
  intervalMs: number;
  eventStartLedger?: number;
  eventLimit?: number;
};

export class WorkerConfigError extends Error {}

/** Reads the loop settings; event scanning stays off until a start ledger is set. */
export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const intervalMs = readPositiveInteger(env.WORKER_INTERVAL_MS, 'WORKER_INTERVAL_MS') ?? 10_000;
  const eventStartLedger = readPositiveInteger(env.WORKER_EVENT_START_LEDGER, 'WORKER_EVENT_START_LEDGER');
  const eventLimit = readPositiveInteger(env.WORKER_EVENT_LIMIT, 'WORKER_EVENT_LIMIT');
  return {
    intervalMs,
    ...(eventStartLedger === undefined ? {} : {eventStartLedger}),
    ...(eventLimit === undefined ? {} : {eventLimit}),
  };
}

/**
 * One reconciliation cycle: submitted payments are checked against their RPC
 * receipt first, then a single contract-event page is reconciled when a start
 * ledger and cursor store are configured.
 */
export type LedgerSource = {
  health(): Promise<{latestLedger: number}>;
};

export function createWorkerCycle(input: {
  state: SettlementConfirmationState;
  rpc: TransactionConfirmationRpc;
  config: WorkerConfig;
  /** Used to close out requests nobody paid. */
  ledgers?: LedgerSource;
  source?: SettlementEventSource;
  cursorStore?: EventCursorStore;
  log?: WorkerLog;
}): () => Promise<void> {
  const log = input.log ?? (entry => console.info(JSON.stringify({level: 'info', ...entry})));

  return async () => {
    const receipts = await confirmSubmittedSettlements({state: input.state, rpc: input.rpc});
    log({event: 'worker_receipt_cycle', ...receipts});

    if (input.ledgers) {
      const {latestLedger} = await input.ledgers.health();
      const expiry = await expireStaleSettlements({state: input.state, latestLedger});
      if (expiry.scanned > 0) log({event: 'worker_expiry_cycle', ...expiry, latestLedger});
    }

    const {eventStartLedger} = input.config;
    if (!input.source || !input.cursorStore || eventStartLedger === undefined) return;

    const events = await reconcileSettlementEventPage({
      state: input.state,
      rpc: input.rpc,
      source: input.source,
      cursorStore: input.cursorStore,
      startLedger: eventStartLedger,
      ...(input.config.eventLimit === undefined ? {} : {limit: input.config.eventLimit}),
    });
    log({event: 'worker_event_cycle', ...events});
  };
}

function readPositiveInteger(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WorkerConfigError(`${name} must be a positive integer`);
  }
  return value;
}
