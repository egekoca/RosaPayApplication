import {startReconciler} from './reconciler';

export {PostgresEventCursorStore} from './PostgresEventCursorStore';
export {PostgresSettlementState} from './PostgresSettlementState';

const log = (entry: Record<string, unknown>) =>
  console.info(JSON.stringify({level: entry.level ?? 'info', ...entry}));

// The loop itself lives in `reconciler.ts` so the API can run the same one in
// its own process. This file is only the standalone service around it.
const reconciler = await startReconciler({log});
if (!reconciler) {
  // Local emulator mode: nothing to reconcile, so report readiness and exit
  // rather than looping over an empty database.
  process.exit(0);
}

let stopping = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  await reconciler.stop();
  log({event: 'worker_stopped', signal});
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}
