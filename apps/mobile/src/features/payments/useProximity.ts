import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {create} from 'zustand';
import {useAppPresence} from '../../shared/appPresence';
import {
  getProximityStatus,
  proximityUnavailable,
  requestProximityPermissions,
  startProximityBroadcast,
  startProximityScanner,
  stopProximityBroadcast,
  type ProximityRequest,
  type ProximityStatus,
} from '../../native/nativeProximity';

/**
 * One answer about the radio, shared by everything that asks.
 *
 * Each caller used to hold its own copy, refreshed only on mount and on the app
 * returning to the foreground. So a grant given on the home screen — the one
 * place that offers the question as a button — reached that screen's copy and
 * no other: the row congratulated itself and disappeared while the scanner,
 * holding a copy that still said "not allowed", stayed switched off. The
 * customer had answered the only prompt they were ever shown and nothing
 * happened, with the control that would have explained it now gone.
 *
 * A grant, a refusal and Bluetooth being switched off are all facts about the
 * device rather than about a screen, so they belong in one place that every
 * caller reads.
 */
type ProximityStatusStore = {
  status: ProximityStatus;
  refresh(): Promise<void>;
  request(): Promise<void>;
};

export const useProximityStatusStore = create<ProximityStatusStore>(set => ({
  status: proximityUnavailable,
  refresh: async () => {
    set({status: await getProximityStatus()});
  },
  request: async () => {
    set({status: await requestProximityPermissions()});
  },
}));

export function useProximityStatus(): ProximityStatus & {request(): void} {
  const status = useProximityStatusStore(state => state.status);
  const refresh = useProximityStatusStore(state => state.refresh);
  const requestPermission = useProximityStatusStore(state => state.request);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', state => {
      // Bluetooth can be switched off, or permission revoked, while away.
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const request = useCallback(() => {
    void requestPermission();
  }, [requestPermission]);

  return {...status, request};
}

export type ProximityBroadcastStatus = ProximityStatus & {
  broadcasting: boolean;
  broadcastError?: string;
  retry(): void;
  /** Raises the platform's one-time Bluetooth prompt. */
  request(): void;
};

/**
 * Advertises `payload` to any customer standing at this counter, and stops the
 * moment the request stops being payable. A paid, cancelled or expired request
 * must not still be on the air for a phone to pick up.
 */
export function useProximityBroadcast(payload: string | null): ProximityBroadcastStatus {
  const status = useProximityStatus();
  const [attempt, setAttempt] = useState(0);
  const asked = useRef(false);
  // Native start/stop are asynchronous. Serializing them stops a late start for
  // an old payload from tearing down the next request's advertisement.
  const operationQueue = useRef<Promise<void>>(Promise.resolve());
  const appActive = useAppPresence();
  const [result, setResult] = useState<
    | {payload: string; state: 'starting' | 'ready'}
    | {payload: string; state: 'failed'; error: string}
    | null
  >(null);

  const ready = status.canBroadcast && status.enabled && status.authorized;

  /**
   * Ask for Bluetooth the moment there is something to offer over it.
   *
   * A counter should not have to find a button before it can be paid. Being
   * handed a payload is the whole context the question needs — a merchant has
   * just put a request up and is waiting for someone to pay it — and it is the
   * one moment where "Rosa Pay uses Bluetooth to pass a payment request between
   * two phones held together" answers itself.
   *
   * Once per mount. Both platforms ask a person once and remember the answer,
   * so a refusal leaves the manual control as the way back rather than a prompt
   * that reappears. The QR is unaffected either way.
   */
  const {request} = status;
  useEffect(() => {
    if (!payload || asked.current || !status.supported || status.authorized) return;
    asked.current = true;
    request();
  }, [payload, request, status.authorized, status.supported]);

  useEffect(() => {
    if (!payload || !ready || !appActive) {
      setResult(null);
      const stop = operationQueue.current.then(() => stopProximityBroadcast());
      operationQueue.current = stop.then(() => undefined, () => undefined);
      return;
    }

    let active = true;
    const start = operationQueue.current.then(async () => {
      if (!active) return;
      setResult({payload, state: 'starting'});
      try {
        await startProximityBroadcast(payload);
        if (!active) {
          await stopProximityBroadcast();
          return;
        }
        setResult({payload, state: 'ready'});
      } catch (error) {
        if (!active) return;
        setResult({
          payload,
          state: 'failed',
          error: error instanceof Error ? error.message : 'The request could not be shared over Bluetooth',
        });
      }
    });
    operationQueue.current = start.then(() => undefined, () => undefined);
    return () => {
      active = false;
      const stop = operationQueue.current.then(() => stopProximityBroadcast());
      operationQueue.current = stop.then(() => undefined, () => undefined);
    };
  }, [appActive, attempt, payload, ready]);

  return {
    ...status,
    broadcasting: Boolean(
      appActive && payload && ready && result?.payload === payload && result.state === 'ready',
    ),
    ...(payload && result?.payload === payload && result.state === 'failed'
      ? {broadcastError: result.error}
      : {}),
    retry: useCallback(() => setAttempt(value => value + 1), []),
  };
}

export type ProximityScannerHandlers = {
  onRequest(request: ProximityRequest): void;
  onError(message: string): void;
};

/**
 * Listens for a nearby merchant while `active`, and stops as soon as it is not.
 *
 * Unlike a tap, a radio does not say what someone meant. Native filters on
 * signal strength so only a phone held against the merchant's is offered, and
 * the screen this leads to still asks the customer to approve.
 */
export function useProximityScanner(
  active: boolean,
  handlers: ProximityScannerHandlers,
): ProximityStatus {
  const status = useProximityStatus();
  const {onRequest, onError} = handlers;
  const handlersRef = useRef({onRequest, onError});
  handlersRef.current = {onRequest, onError};
  const appActive = useAppPresence();
  const asked = useRef(false);

  /**
   * Ask for Bluetooth on the paying side too.
   *
   * `authorized` is a real grant, never "not asked yet", and raising the prompt
   * is what allocates the managers that make the radio usable. Only the
   * merchant half ever asked — so a phone that had never put a request up had
   * never been handed the question, `listening` below could not become true,
   * and the scanner was never started. Holding that phone against a merchant's
   * did nothing, silently and for ever: the customer is the one side that never
   * gets a second chance to ask.
   *
   * Once per mount, like the merchant side, so a refusal leaves the manual
   * control as the way back rather than a prompt that reappears. Scanning is
   * the whole context the question needs — someone has the pay screen open and
   * is holding their phone to a counter.
   */
  const {request} = status;
  useEffect(() => {
    if (!active || asked.current || !status.supported || status.authorized) return;
    asked.current = true;
    request();
  }, [active, request, status.authorized, status.supported]);

  const listening = active && appActive && status.supported && status.enabled && status.authorized;

  useEffect(() => {
    if (!listening) return;
    const stop = startProximityScanner({
      onRequest: request => handlersRef.current.onRequest(request),
      onError: message => handlersRef.current.onError(message),
    });
    return stop;
  }, [listening]);

  return status;
}
