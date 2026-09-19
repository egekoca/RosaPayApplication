import {createPostgresPool, readPostgresOptions} from '@rosapay/postgres';
import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';
import {createConfirmationLoop} from './confirmationWorker';
import {PostgresEventCursorStore} from './PostgresEventCursorStore';
import {PostgresSettlementState} from './PostgresSettlementState';
import {createWorkerCycle, readWorkerConfig} from './runtime';

export {PostgresEventCursorStore} from './PostgresEventCursorStore';
export {PostgresSettlementState} from './PostgresSettlementState';

const log = (entry: Record<string, unknown>) =>
  console.info(JSON.stringify({level: entry.level ?? 'info', ...entry}));

const config = createStellarConfig(process.env.STELLAR_NETWORK ?? 'testnet', {
  rpcUrl: process.env.STELLAR_RPC_URL,
  settlementContractId: process.env.STELLAR_SETTLEMENT_CONTRACT_ID,
});
const rpc = new StellarRpcClient(config);
const health = await rpc.health();
log({event: 'worker_stellar_ready', ...health});

const database = readPostgresOptions();
if (!database) {
  // Local emulator mode: without a database there is no settlement state to
  // reconcile, so the worker reports readiness and exits instead of looping.
  log({event: 'worker_idle', reason: 'DATABASE_URL is not set'});
  process.exit(0);
}

const workerConfig = readWorkerConfig();
const connection = createPostgresPool(database);
const cursorStore = new PostgresEventCursorStore(connection);
const loop = createConfirmationLoop({
  run: createWorkerCycle({
    state: new PostgresSettlementState(connection),
    rpc,
    config: workerConfig,
    ledgers: rpc,
    source: rpc,
    cursorStore,
    log,
  }),
  intervalMs: workerConfig.intervalMs,
  onError: error =>
    log({
      level: 'error',
      event: 'worker_cycle_failed',
      message: error instanceof Error ? error.message : 'Unknown worker failure',
    }),
});

let stopping = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  loop.stop();
  await connection.close();
  log({event: 'worker_stopped', signal});
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}

log({
  event: 'worker_started',
  intervalMs: workerConfig.intervalMs,
  eventScanning: workerConfig.eventStartLedger !== undefined,
});
loop.start();
