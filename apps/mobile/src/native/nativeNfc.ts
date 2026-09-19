import {NativeEventEmitter, NativeModules, Platform, type EmitterSubscription} from 'react-native';

export type NfcStatus = {
  /** The device has NFC hardware at all. */
  supported: boolean;
  /** NFC is switched on in system settings. */
  enabled: boolean;
  /** The device can publish a request for another phone to read. */
  canBroadcast: boolean;
};

export type NfcModule = {
  getStatus(): Promise<NfcStatus>;
  startBroadcast(payload: string): Promise<void>;
  stopBroadcast(): Promise<void>;
  startReading(): Promise<void>;
  stopReading(): Promise<void>;
};

const READ_EVENT = 'RosaPayNfcRequestRead';
const ERROR_EVENT = 'RosaPayNfcError';

/**
 * Tapping is an Android transport. iOS gives no app the ability to emulate a
 * card, and Apple's reader session cannot be driven the way this flow needs, so
 * on iOS the QR code is the whole story rather than a degraded tap.
 */
export const nfcUnavailable: NfcStatus = {supported: false, enabled: false, canBroadcast: false};

function module(): NfcModule | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules.RosaPayNfc as NfcModule | undefined) ?? null;
}

export function getNfcStatus(): Promise<NfcStatus> {
  return module()?.getStatus().catch(() => nfcUnavailable) ?? Promise.resolve(nfcUnavailable);
}

export function startNfcBroadcast(payload: string): Promise<void> {
  const native = module();
  if (!native) return Promise.resolve();
  return native.startBroadcast(payload).catch(() => undefined);
}

export function stopNfcBroadcast(): Promise<void> {
  return module()?.stopBroadcast().catch(() => undefined) ?? Promise.resolve();
}

export type NfcReaderHandlers = {
  onRequest(payload: string): void;
  onError(message: string): void;
};

/**
 * Starts reader mode and returns a function that stops it. The caller always
 * gets a stopper, even when NFC is unavailable, so screens do not have to guard
 * their own cleanup.
 */
export function startNfcReader(handlers: NfcReaderHandlers): () => void {
  const native = module();
  if (!native) return () => undefined;

  const emitter = new NativeEventEmitter(NativeModules.RosaPayNfc);
  const subscriptions: EmitterSubscription[] = [
    emitter.addListener(READ_EVENT, (payload: string) => handlers.onRequest(payload)),
    emitter.addListener(ERROR_EVENT, (message: string) => handlers.onError(message)),
  ];

  let stopped = false;
  native.startReading().catch((error: {message?: string}) => {
    if (!stopped) handlers.onError(error?.message ?? 'Tapping is unavailable on this device');
  });

  return () => {
    stopped = true;
    subscriptions.forEach(subscription => subscription.remove());
    void native.stopReading().catch(() => undefined);
  };
}
