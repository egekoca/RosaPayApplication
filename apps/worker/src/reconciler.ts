import {
  createPostgresPool,
  readPostgresOptions,
  type PostgresConnection,
  type PostgresPoolOptions,
} from '@rosapay/postgres';
import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';
import {createConfirmationLoop} from './confirmationWorker';
import {PostgresEventCursorStore} from './PostgresEventCursorStore';
import {PostgresSettlementState} from './PostgresSettlementState';
import {createWorkerCycle, readWorkerConfig, type WorkerLog} from './runtime';

export {PostgresEventCursorStore} from './PostgresEventCursorStore';
export {PostgresSettlementState} from './PostgresSettlementState';
export * from './confirmationWorker';
export * from './runtime';

export type Reconciler = {
  /** Stops the loop. The pool is only closed when this module opened it. */
  stop: () => Promise<void>;
};

/**
 * The reconciliation loop, detached from any one process.
 *
 * Nothing connects *to* this: it reads settlements from PostgreSQL and asks
 * Stellar RPC what became of them, both outbound. That is what lets the same
 * loop run either as its own service or inside the API, which is the
 * difference between paying for a second Render service and not - and a
 * settlement only ever reaches `confirmed` here, so on a deployment without it
 * a payment that succeeded on chain never reaches the merchant's screen.
 */
export async function startReconciler(input: {
  env?: NodeJS.ProcessEnv;
  /** Reuses the caller's pool - the API already holds one - instead of opening a second. */
  connection?: PostgresConnection;
  database?: PostgresPoolOptions;
  log?: WorkerLog;
}): Promise<Reconciler | null> {
  const env = input.env ?? process.env;
  const log = input.log ?? (entry => console.info(JSON.stringify({level: entry.level ?? 'info', ...entry})));

  const database = input.database ?? readPostgresOptions(env);
  if (!input.connection && !database) {
    // Without a database there is no settlement state to reconcile.
    log({event: 'worker_idle', reason: 'DATABASE_URL is not set'});
    return null;
  }

  const config = createStellarConfig(env.STELLAR_NETWORK ?? 'testnet', {
    rpcUrl: env.STELLAR_RPC_URL,
    settlementContractId: env.STELLAR_SETTLEMENT_CONTRACT_ID,
  });
  const rpc = new StellarRpcClient(config);
  const health = await rpc.health();
  log({event: 'worker_stellar_ready', ...health});

  const workerConfig = readWorkerConfig(env);
  const owned = input.connection ? undefined : createPostgresPool(database!);
  const connection = input.connection ?? owned!;

  const loop = createConfirmationLoop({
    run: createWorkerCycle({
      state: new PostgresSettlementState(connection),
      rpc,
      config: workerConfig,
      ledgers: rpc,
      source: rpc,
      cursorStore: new PostgresEventCursorStore(connection),
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

  log({
    event: 'worker_started',
    intervalMs: workerConfig.intervalMs,
    eventScanning: workerConfig.eventStartLedger !== undefined,
  });
  loop.start();

  return {
    stop: async () => {
      loop.stop();
      // A borrowed pool belongs to whoever lent it and is theirs to close.
      if (owned) await owned.close();
    },
  };
}
