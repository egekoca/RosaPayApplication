import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
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

export function useProximityStatus(): ProximityStatus & {request(): void} {
  const [status, setStatus] = useState<ProximityStatus>(proximityUnavailable);

  useEffect(() => {
    let cancelled = false;
    void getProximityStatus().then(next => {
      if (!cancelled) setStatus(next);
    });
    const subscription = AppState.addEventListener('change', state => {
      // Bluetooth can be switched off, or permission revoked, while away.
      if (state === 'active') {
        void getProximityStatus().then(next => {
          if (!cancelled) setStatus(next);
        });
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const request = useCallback(() => {
    void requestProximityPermissions().then(setStatus);
  }, []);

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
