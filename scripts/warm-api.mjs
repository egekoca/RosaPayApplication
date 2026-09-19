/**
 * Brings the hosted API up and does not exit until it answers, so a demo does
 * not start on a stopped instance.
 *
 * Run this before showing the app to anyone. A free host stops an idle instance
 * after fifteen minutes and takes thirty to forty-five seconds to start it
 * again, and every request that arrives during the start-up waits for it —
 * including the health check the app fires at launch. So the app's own warm-up
 * only helps someone who spends that long in the app before paying. Anyone who
 * opens it and pays immediately lands mid-start and waits out the remainder.
 *
 * Warming it here moves that wait to before the demo, where nobody is watching.
 * From then on the app keeps it up on its own: `useApiWarmup` pings every ten
 * minutes while the app is open, which is inside the fifteen-minute window.
 *
 *   npm run api:warm
 *   npm run api:warm -- https://some-other-host
 */

import {readFileSync} from 'node:fs';

const DEFAULT_TIMEOUT_MS = 120_000;
const ATTEMPT_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 2_000;

function readBaseUrl() {
  const fromArgs = process.argv[2]?.trim();
  if (fromArgs) return fromArgs.replace(/\/+$/, '');

  const fromEnv = process.env.ROSAPAY_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  // The deployment manifest is where the app itself reads the address, so
  // warming a different one than the app will call would prove nothing.
  const manifest = new URL('../config/testnet-deployment.json', import.meta.url);
  const {apiBaseUrl} = JSON.parse(readFileSyncSafe(manifest) ?? '{}');
  if (typeof apiBaseUrl === 'string' && apiBaseUrl.trim()) return apiBaseUrl.trim().replace(/\/+$/, '');

  throw new Error(
    'No API address. Pass one as an argument, set ROSAPAY_API_BASE_URL, or fill apiBaseUrl in config/testnet-deployment.json.',
  );
}

function readFileSyncSafe(url) {
  try {
    return readFileSync(url, 'utf8');
  } catch {
    return null;
  }
}

async function attempt(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/v1/health`, {signal: controller.signal});
    if (!response.ok) return {ok: false, detail: `HTTP ${response.status}`};
    const body = await response.json();
    return {ok: body?.status === 'ok', detail: JSON.stringify(body)};
  } catch (error) {
    return {ok: false, detail: error.name === 'AbortError' ? 'no answer yet' : error.message};
  } finally {
    clearTimeout(timer);
  }
}

const baseUrl = readBaseUrl();
const deadline = Date.now() + Number(process.env.ROSAPAY_WARM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
const startedAt = Date.now();

process.stdout.write(`Waking ${baseUrl}`);

let tries = 0;
for (;;) {
  tries += 1;
  const result = await attempt(baseUrl);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.ok) {
    process.stdout.write('\n');
    console.log(`Ready after ${elapsed}s (${tries} ${tries === 1 ? 'request' : 'requests'})`);
    console.log(result.detail);
    // A cold start is only paid once, but the instance sleeps again fifteen
    // minutes after the last request, so this is a window rather than a switch.
    console.log('\nStays up for 15 minutes after the last request. Open the app before then.');
    process.exit(0);
  }

  if (Date.now() >= deadline) {
    process.stdout.write('\n');
    console.error(`Still not answering after ${elapsed}s: ${result.detail}`);
    console.error('Check the host is deployed and DATABASE_URL is set, then run this again.');
    process.exit(1);
  }

  process.stdout.write('.');
  await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
}
