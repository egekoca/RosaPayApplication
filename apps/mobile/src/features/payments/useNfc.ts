import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {
  getNfcStatus,
  nfcUnavailable,
  startNfcBroadcast,
  startNfcReader,
  stopNfcBroadcast,
  type NfcStatus,
} from '../../native/nativeNfc';

export function useNfcStatus(): NfcStatus {
  const [status, setStatus] = useState<NfcStatus>(nfcUnavailable);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getNfcStatus().then(next => {
        if (!cancelled) setStatus(next);
      });
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      // NFC can be enabled or disabled in Settings while the app is away.
      if (state === 'active') refresh();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return status;
}

/**
 * Offers `payload` to any customer who taps this phone, and stops the moment the
 * request stops being payable. A request that was paid, cancelled or expired must
 * not still be sitting on the NFC controller waiting to be handed out.
 */
export type NfcBroadcastStatus = NfcStatus & {
  broadcasting: boolean;
  broadcastError?: string;
  retry(): void;
};

export function useNfcBroadcast(payload: string | null): NfcBroadcastStatus {
  const status = useNfcStatus();
  const [attempt, setAttempt] = useState(0);
  // Native HCE start/stop calls are asynchronous. Serializing them prevents a
  // late start for an old QR payload from stopping the next request's broadcast.
  const operationQueue = useRef<Promise<void>>(Promise.resolve());
  const [appActive, setAppActive] = useState(
    AppState.currentState === 'active',
  );
  const [result, setResult] = useState<
    | {payload: string; state: 'starting' | 'ready'}
    | {payload: string; state: 'failed'; error: string}
    | null
  >(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!payload || !status.canBroadcast || !status.enabled || !appActive) {
      setResult(null);
      const stop = operationQueue.current.then(() => stopNfcBroadcast());
      operationQueue.current = stop.then(() => undefined, () => undefined);
      return;
    }

    let active = true;
    const start = operationQueue.current.then(async () => {
      if (!active) return;
      setResult({payload, state: 'starting'});
      try {
        await startNfcBroadcast(payload);
        if (!active) {
          await stopNfcBroadcast();
          return;
        }
        setResult({payload, state: 'ready'});
      } catch (error) {
        if (!active) return;
        setResult({
          payload,
          state: 'failed',
          error: error instanceof Error ? error.message : 'The NFC request could not be shared',
        });
      }
    });
    operationQueue.current = start.then(() => undefined, () => undefined);
    return () => {
      active = false;
      const stop = operationQueue.current.then(() => stopNfcBroadcast());
      operationQueue.current = stop.then(() => undefined, () => undefined);
    };
  }, [appActive, attempt, payload, status.canBroadcast, status.enabled]);

  return {
    ...status,
    broadcasting: Boolean(
      appActive && payload && status.canBroadcast && status.enabled && result?.payload === payload && result.state === 'ready',
    ),
    ...(payload && result?.payload === payload && result.state === 'failed'
      ? {broadcastError: result.error}
      : {}),
    retry: useCallback(() => setAttempt(value => value + 1), []),
  };
}

export type NfcReaderHandlers = {
  onRequest(payload: string): void;
  onError(message: string): void;
};

export type NfcReader = NfcStatus & {
  /**
   * Opens the reader when the platform will not let it sit armed. Undefined
   * where `startTap` would be meaningless — Android already listens, and a
   * device without NFC has nothing to open — so a screen can render its tap
   * button on exactly `reader.startTap !== undefined`.
   */
  startTap?: () => void;
};

/**
 * Reads a merchant's tap while `active`, and stops as soon as it is not.
 *
 * On Android reader mode polls silently, so it is armed for as long as `active`
 * holds. On iOS a session puts a system sheet over the screen, so nothing opens
 * until `startTap` is called and the session closes itself after one read.
 */
export function useNfcReader(active: boolean, handlers: NfcReaderHandlers): NfcReader {
  const status = useNfcStatus();
  const {onRequest, onError} = handlers;
  const handlersRef = useRef({onRequest, onError});
  handlersRef.current = {onRequest, onError};
  const needsUserActionRef = useRef(status.needsUserAction);
  needsUserActionRef.current = status.needsUserAction;
  const [tapRequested, setTapRequested] = useState(false);
  const [appActive, setAppActive] = useState(
    AppState.currentState === 'active',
  );
  const ready = status.supported && status.enabled;
  const listening = active && appActive && ready && (!status.needsUserAction || tapRequested);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!listening) return;
    const stop = startNfcReader({
      onRequest: payload => {
        // CoreNFC sessions are one-shot. Re-arm the explicit tap affordance
        // after a successful read so a later attempt can start a new session.
        if (needsUserActionRef.current) setTapRequested(false);
        handlersRef.current.onRequest(payload);
      },
      onError: message => {
        // A cancelled, timed-out or interrupted iOS session has ended even when
        // the screen itself remains open. Make the next tap available again.
        if (needsUserActionRef.current) setTapRequested(false);
        handlersRef.current.onError(message);
      },
      onEnded: () => {
        if (needsUserActionRef.current) setTapRequested(false);
      },
    });
    return () => {
      // A user-driven session is one read long: clearing the request here means
      // the next tap needs the button again rather than silently reopening.
      setTapRequested(false);
      stop();
    };
  }, [listening]);

  const startTap = useCallback(() => setTapRequested(true), []);

  return {
    ...status,
    startTap: active && ready && status.needsUserAction && !tapRequested ? startTap : undefined,
  };
}
