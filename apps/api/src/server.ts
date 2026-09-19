import {buildApp} from './app';
import {createApiRuntime} from './bootstrap';
import {DeviceAuthService} from './application/DeviceAuthService';
import {createDeviceAuthResolver} from './application/AuthContext';

const port = Number.parseInt(process.env.API_PORT ?? '4100', 10);
const host = process.env.API_HOST ?? '127.0.0.1';
const runtime = createApiRuntime();
const authRequired = process.env.API_AUTH_REQUIRED === 'true';
const sessionSecret = process.env.API_SESSION_SECRET;
if (authRequired && !sessionSecret) throw new Error('API_SESSION_SECRET is required when API_AUTH_REQUIRED is true');
const deviceAuth = sessionSecret ? new DeviceAuthService(runtime.deviceAuth, sessionSecret) : undefined;
const app = buildApp({
  repository: runtime.repository,
  storage: runtime.storage,
  merchantProfiles: runtime.merchantProfiles,
  walletRepository: runtime.wallets,
  auditLog: runtime.auditLog,
  ...(deviceAuth ? {
    deviceAuth,
    auth: {
      required: authRequired,
      resolve: createDeviceAuthResolver(deviceAuth, runtime.merchantProfiles, runtime.wallets),
    },
  } : {}),
});

app.log.info({
  storage: runtime.storage,
  authRequired,
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
