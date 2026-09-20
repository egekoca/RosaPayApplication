import {NativeEventEmitter, NativeModules, Platform, type EmitterSubscription} from 'react-native';

/**
 * The Bluetooth LE transport for RTP/1, and the only way two iPhones can do
 * what an Android pair does over NFC.
 *
 * iOS gives no third-party app card emulation, so an iPhone merchant publishes
 * nothing an iPhone customer could tap. Core Bluetooth has no such restriction:
 * either phone can be the peripheral. So the merchant advertises the same
 * signed request its QR carries, and a customer's phone picks it up while the
 * app is simply open.
 *
 * Nothing here is trusted any more than a camera is. The payload is the public,
 * merchant-signed request; the customer still verifies the signature and the
 * expiry, and still answers a device prompt before anything is spent. Radio
 * proximity decides which request to *offer*, never whether to pay it.
 */
export type ProximityStatus = {
  /** The device has Bluetooth LE at all. */
  supported: boolean;
  /** Bluetooth is switched on. */
  enabled: boolean;
  /**
   * The OS has granted what this transport needs. iOS asks once, on first use;
   * Android 12 and later require the scan/advertise/connect runtime grants.
   */
  authorized: boolean;
  /** The device can advertise a request for another phone to pick up. */
  canBroadcast: boolean;
};

export type ProximityModule = {
  getStatus(): Promise<ProximityStatus>;
  requestPermissions(): Promise<ProximityStatus>;
  startBroadcast(payload: string): Promise<void>;
  stopBroadcast(): Promise<void>;
  startScanning(): Promise<void>;
  stopScanning(): Promise<void>;
};

const READ_EVENT = 'RosaPayProximityRequestRead';
const ERROR_EVENT = 'RosaPayProximityError';
const DIAGNOSTIC_EVENT = 'RosaPayProximityDiagnostic';

export const proximityUnavailable: ProximityStatus = {
  supported: false,
  enabled: false,
  authorized: false,
  canBroadcast: false,
};

function module(): ProximityModule | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  return (NativeModules.RosaPayProximity as ProximityModule | undefined) ?? null;
}

/** Normalized here so a native build predating a field cannot read as "ready". */
function normalize(status: Partial<ProximityStatus>): ProximityStatus {
  return {
    supported: status.supported === true,
    enabled: status.enabled === true,
    authorized: status.authorized === true,
    canBroadcast: status.canBroadcast === true,
  };
}

export function getProximityStatus(): Promise<ProximityStatus> {
  const native = module();
  if (!native) return Promise.resolve(proximityUnavailable);
  return native.getStatus().then(normalize).catch(() => proximityUnavailable);
}

/**
 * Asks for whatever the platform withholds until asked. Safe to call when it is
 * already granted: both platforms answer from what they already know rather
 * than prompting twice.
 */
export function requestProximityPermissions(): Promise<ProximityStatus> {
  const native = module();
  if (!native) return Promise.resolve(proximityUnavailable);
  return native.requestPermissions().then(normalize).catch(() => proximityUnavailable);
}

export function startProximityBroadcast(payload: string): Promise<void> {
  const native = module();
  if (!native) return Promise.reject(new Error('Bluetooth sharing is unavailable on this device'));
  return native.startBroadcast(payload);
}

export function stopProximityBroadcast(): Promise<void> {
  return module()?.stopBroadcast().catch(() => undefined) ?? Promise.resolve();
}

/**
 * A request, and whether the two phones were being held together when it was
 * read. The radio cannot prove intent the way a tap can, so native reports what
 * the signal said and the screen decides how far to take it.
 */
export type ProximityRequest = {
  payload: string;
  touching: boolean;
};

export type ProximityScannerHandlers = {
  onRequest(request: ProximityRequest): void;
  onError(message: string): void;
};

/**
 * Scans for a merchant close enough to be the one the customer is standing at,
 * and returns a function that stops. The caller always gets a stopper, even
 * where Bluetooth is unavailable, so screens do not guard their own cleanup.
 */
export function startProximityScanner(handlers: ProximityScannerHandlers): () => void {
  const native = module();
  if (!native) return () => undefined;

  const emitter = new NativeEventEmitter(NativeModules.RosaPayProximity);
  const subscriptions: EmitterSubscription[] = [
    emitter.addListener(READ_EVENT, (event: Partial<ProximityRequest> | undefined) => {
      // A native build that predates the proximity verdict must not have its
      // silence read as "the phones were touching".
      if (typeof event?.payload !== 'string' || !event.payload) return;
      handlers.onRequest({payload: event.payload, touching: event.touching === true});
    }),
    emitter.addListener(ERROR_EVENT, (message: string) => handlers.onError(message)),
  ];

  let stopped = false;
  native.startScanning().catch((error: {message?: string}) => {
    if (!stopped) handlers.onError(error?.message ?? 'Bluetooth is unavailable on this device');
  });

  return () => {
    stopped = true;
    subscriptions.forEach(subscription => subscription.remove());
    void native.stopScanning().catch(() => undefined);
  };
}

/**
 * Narration of what the radio is doing, for the diagnostics screen.
 *
 * Two phones held together that do nothing look the same from the outside
 * whether nothing is advertising, nothing is seen, or the other phone is seen
 * steadily and simply reads weaker than the thresholds ask for. Those have
 * different fixes, so native says which it is and carries the reading it
 * judged. Subscribing here starts nothing and stops nothing: the scanner and
 * the advertisement are driven by the payment screens, and this only listens.
 */
export function subscribeToProximityDiagnostics(onMessage: (message: string) => void): () => void {
  const native = module();
  if (!native) return () => undefined;
  const emitter = new NativeEventEmitter(NativeModules.RosaPayProximity);
  const subscription = emitter.addListener(DIAGNOSTIC_EVENT, (message: unknown) => {
    if (typeof message === 'string' && message) onMessage(message);
  });
  return () => subscription.remove();
}
