import {buildApp} from './app';
import {createApiRuntime} from './bootstrap';
import {DeviceAuthService} from './application/DeviceAuthService';
import {createDeviceAuthResolver} from './application/AuthContext';
import {PriceService} from './application/PriceService';
import {CoinGeckoRateProvider} from './infrastructure/CoinGeckoRateProvider';
import {startReconciler} from '@rosapay/worker';

const port = Number.parseInt(process.env.API_PORT ?? '4100', 10);
const host = process.env.API_HOST ?? '127.0.0.1';
const runtime = createApiRuntime();
const authRequired = process.env.API_AUTH_REQUIRED === 'true';
const sessionSecret = process.env.API_SESSION_SECRET;
if (authRequired && !sessionSecret) throw new Error('API_SESSION_SECRET is required when API_AUTH_REQUIRED is true');
const deviceAuth = sessionSecret ? new DeviceAuthService(runtime.deviceAuth, sessionSecret) : undefined;

/**
 * The currencies a merchant may price in, and the assets they may be paid in.
 * Both are configuration because the rate feed is: adding a currency here that
 * the feed cannot price would offer a merchant a menu price nothing can convert.
 */
const prices = new PriceService({
  provider: new CoinGeckoRateProvider({
    ...(process.env.RATE_FEED_API_KEY ? {apiKey: process.env.RATE_FEED_API_KEY} : {}),
  }),
  sellAssets: [
    'stellar:native',
    'stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  ],
  /*
   * Lira first because it is what this product is for, and the rest because a
   * wallet that can only read itself in one currency is a wallet for one
   * country. Every one of these is a market rate; only lira has an anchor
   * behind it that would actually exchange at it, and the screens say so.
   */
  buyAssets: ['iso4217:TRY', 'iso4217:USD', 'iso4217:NGN', 'iso4217:EUR'],
});
const app = buildApp({
  repository: runtime.repository,
  storage: runtime.storage,
  ...(runtime.connection
    ? {probeDatabase: async () => void (await runtime.connection!.query('select 1', []))}
    : {}),
  merchantProfiles: runtime.merchantProfiles,
  walletRepository: runtime.wallets,
  auditLog: runtime.auditLog,
  prices,
  ...(deviceAuth ? {
    deviceAuth,
    auth: {
      required: authRequired,
      resolve: createDeviceAuthResolver(deviceAuth, runtime.merchantProfiles, runtime.wallets),
    },
  } : {}),
});

/**
 * The reconciler, optionally in this process rather than beside it.
 *
 * A settlement only ever reaches `confirmed` in the reconciliation loop, so a
 * deployment without it shows a merchant nothing after a payment that in fact
 * succeeded on chain. Run as its own service that costs a paid plan on hosts
 * with no free background worker, which is a real bill for a demo settling a
 * handful of payments. It opens no port and only makes outbound calls, so
 * nothing about it needs a service of its own.
 *
 * It shares the API's pool, and the loop wakes whenever this process is awake -
 * on a host that sleeps an idle service, the submit that creates work to
 * reconcile is itself the request that wakes it.
 */
const reconciler = process.env.WORKER_IN_PROCESS === 'true'
  ? await startReconciler({
      ...(runtime.connection ? {connection: runtime.connection} : {}),
      log: entry => app.log.info(entry, String(entry.event ?? 'worker')),
    })
  : null;

app.log.info({
  storage: runtime.storage,
  authRequired,
  relayer: Boolean(process.env.STELLAR_RELAYER_SECRET),
  reconciler: Boolean(reconciler),
}, 'api_starting');

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({signal}, 'api_shutting_down');
  try {
    await app.close();
  } finally {
    // Before the pool it borrowed is closed underneath it.
    await reconciler?.stop();
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
