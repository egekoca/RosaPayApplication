import {useEffect, useRef, useState} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import {RosaPayApiClient} from '../api/client';
import {hasHostedApi} from '../shared/apiConfig';
import {useAppStore} from '../state/appStore';

/**
 * How long a free host leaves an idle instance running before stopping it.
 * Render's is fifteen minutes; the ping below has to land inside that window.
 */
const SLEEP_AFTER_MS = 15 * 60_000;

/**
 * Ten minutes, not fifteen seconds.
 *
 * The instance sleeps after fifteen minutes without a request, so anything
 * comfortably under that keeps it up — and a ping every ten minutes is already
 * the last one it needed. Going to fifteen seconds would send forty times the
 * requests to hold the same instance awake, on someone's mobile data, and the
 * host counts those hours against a monthly allowance: a free web service gets
 * 750 instance-hours and a month is about 730, so the sleeping is most of what
 * keeps the service inside its own budget. Keeping it awake around the clock
 * from a cron job would spend the allowance by month's end and take the API
 * down altogether, which is worse than a cold start.
 */
const PING_EVERY_MS = 10 * 60_000;

/** Long enough away that the instance may have stopped while we were gone. */
const STALE_AFTER_MS = 60_000;

export type ApiWarmth =
  /** No hosted API in this build, so there is nothing to wake. */
  | 'local'
  /** A request is in flight and has not answered yet. */
  | 'waking'
  /** The API answered, so a payment will not pay the cold start. */
  | 'ready'
  /** The API did not answer. Not fatal on its own — the payment path retries. */
  | 'unreachable';

/**
 * Wakes the hosted API while someone is still looking at the app, so the
 * cold start does not land on a payment.
 *
 * The free host stops an idle instance, and starting it again took between
 * twelve and forty-two seconds when measured. Nothing on the launch path used
 * to touch the API — the ledger health check goes straight to Stellar RPC —
 * and the first call was `ensureDeviceSession` from the settlement itself. So
 * the whole wake-up was paid by a customer who had already pressed Approve,
 * with no indication of why the screen had stopped.
 *
 * This moves that cost to app launch, where there is something else to look at,
 * and keeps the instance up for as long as the app is open. It cannot cover
 * every case: a customer who opens the app and pays within twenty seconds still
 * waits, which is why `warmth` is exposed rather than kept private.
 */
export function useApiWarmup(): ApiWarmth {
  const baseUrl = useAppStore(state => state.apiBaseUrl);
  const [warmth, setWarmth] = useState<ApiWarmth>(hasHostedApi ? 'waking' : 'local');
  // A ping in flight when the app is backgrounded must not resolve into state
  // belonging to a later foreground.
  const pingedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!hasHostedApi) {
      setWarmth('local');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const ping = () => {
      const startedAt = Date.now();
      pingedAt.current = startedAt;
      setWarmth(current => (current === 'ready' ? current : 'waking'));
      const client = new RosaPayApiClient({baseUrl});
      void client
        .health()
        .then(() => {
          if (!cancelled) setWarmth('ready');
        })
        .catch(() => {
          // A failed wake-up is not worth surfacing as an error: the payment
          // path has its own retries, and the host answers slowly rather than
          // never. It only means the next call may still pay the start-up.
          if (!cancelled) setWarmth('unreachable');
        });
    };

    const startPolling = () => {
      clearInterval(timer);
      timer = setInterval(ping, PING_EVERY_MS);
    };

    ping();
    startPolling();

    const handle = (status: AppStateStatus) => {
      if (status !== 'active') {
        // Timers do not run in the background, so the instance is free to sleep
        // while the app is away. Stop pretending otherwise.
        clearInterval(timer);
        timer = undefined;
        return;
      }
      // Coming back after a while means the instance has had time to stop, and
      // the interval that would have kept it up was not running.
      const away = pingedAt.current === null ? Infinity : Date.now() - pingedAt.current;
      if (away > STALE_AFTER_MS) ping();
      startPolling();
    };

    const subscription = AppState.addEventListener('change', handle);
    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [baseUrl]);

  return warmth;
}

export const apiWarmupTimings = {PING_EVERY_MS, SLEEP_AFTER_MS, STALE_AFTER_MS};
