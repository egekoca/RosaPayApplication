import {buildApp} from './app';
import {createApiRuntime} from './bootstrap';
import {DeviceAuthService} from './application/DeviceAuthService';
import {createDeviceAuthResolver} from './application/AuthContext';
import {PriceService} from './application/PriceService';
import {CoinGeckoRateProvider} from './infrastructure/CoinGeckoRateProvider';

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
