import {useEffect, useState} from 'react';
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

/** Reads a merchant's tap while `active`, and stops as soon as it is not. */
export function useNfcReader(active: boolean, handlers: NfcReaderHandlers): NfcStatus {
  const status = useNfcStatus();
  const {onRequest, onError} = handlers;

  useEffect(() => {
    if (!active || !status.supported || !status.enabled) return;
    return startNfcReader({onRequest, onError});
  }, [active, status.supported, status.enabled, onRequest, onError]);

  return status;
}
