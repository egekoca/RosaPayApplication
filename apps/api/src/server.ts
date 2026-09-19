import {buildApp} from './app';
import {createApiRuntime} from './bootstrap';

const port = Number.parseInt(process.env.API_PORT ?? '4100', 10);
const host = process.env.API_HOST ?? '127.0.0.1';
const runtime = createApiRuntime();
const app = buildApp({
  repository: runtime.repository,
  merchantProfiles: runtime.merchantProfiles,
  walletRepository: runtime.wallets,
  auditLog: runtime.auditLog,
});

app.log.info({
  storage: runtime.storage,
  authRequired: process.env.API_AUTH_REQUIRED === 'true',
  relayer: Boolean(process.env.STELLAR_RELAYER_SECRET),
}, 'api_starting');

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({signal}, 'api_shutting_down');
  try {
    await app.close();
  } finally {
    await runtime.close();
  }
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}

try {
  await app.listen({host, port});
} catch (error) {
  app.log.error({err: error}, 'api_start_failed');
  await runtime.close();
  process.exit(1);
}
