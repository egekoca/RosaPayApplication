import {useCallback, useEffect, useState} from 'react';
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
    void getNfcStatus().then(next => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

/**
 * Offers `payload` to any customer who taps this phone, and stops the moment the
 * request stops being payable. A request that was paid, cancelled or expired must
 * not still be sitting on the NFC controller waiting to be handed out.
 */
export function useNfcBroadcast(payload: string | null): NfcStatus {
  const status = useNfcStatus();

  useEffect(() => {
    if (!payload || !status.canBroadcast || !status.enabled) return;
    void startNfcBroadcast(payload);
    return () => {
      void stopNfcBroadcast();
    };
  }, [payload, status.canBroadcast, status.enabled]);

  return status;
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
  const [tapRequested, setTapRequested] = useState(false);
  const ready = status.supported && status.enabled;
  const listening = active && ready && (!status.needsUserAction || tapRequested);

  useEffect(() => {
    if (!listening) return;
    const stop = startNfcReader({onRequest, onError});
    return () => {
      // A user-driven session is one read long: clearing the request here means
      // the next tap needs the button again rather than silently reopening.
      setTapRequested(false);
      stop();
    };
  }, [listening, onRequest, onError]);

  const startTap = useCallback(() => setTapRequested(true), []);

  return {
    ...status,
    startTap: active && ready && status.needsUserAction && !tapRequested ? startTap : undefined,
  };
}
