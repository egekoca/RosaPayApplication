import {NativeEventEmitter, NativeModules, Platform, type EmitterSubscription} from 'react-native';
import {
  offlineSessionKindCode,
  offlineSessionKindOf,
  type OfflineSessionKind,
} from '@rosapay/protocol';

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
  /**
   * Sends one message to one peer, in whichever direction this phone is facing.
   *
   * Native knows which of the two a peer is — a customer subscribed to this
   * phone's advertisement, or a merchant this phone has connected to — so a
   * caller only names the peer. That is what makes the offline conversation
   * symmetric at this level: both halves send and both halves receive.
   */
  sendMessage(peerId: string, kind: number, payload: string): Promise<void>;
  /**
   * Keeps a link alive past the screen that made it. Leaving the screen the
   * radio listens on stops the scanner, and a payment that has only just been
   * put in front of someone has not started its conversation yet.
   */
  holdPeer(peerId: string): Promise<void>;
  /** Drops a peer, so a finished or abandoned payment does not hold a link open. */
  releasePeer(peerId: string): Promise<void>;
};

const MESSAGE_EVENT = 'RosaPayProximityMessage';
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
 * Sends one message of the offline conversation to one peer.
 *
 * Unlike the advertisement, this is addressed: an offline payment is a sequence
 * between exactly two phones, and a counter with two customers in front of it is
 * holding two of them at once.
 */
export function sendProximityMessage(
  peerId: string,
  kind: OfflineSessionKind,
  payload: string,
): Promise<void> {
  const native = module();
  if (!native) return Promise.reject(new Error('Bluetooth sharing is unavailable on this device'));
  return native.sendMessage(peerId, offlineSessionKindCode(kind), payload);
}

/** Keeps this merchant connected while its payment is on screen. */
export function holdProximityPeer(peerId: string): Promise<void> {
  return module()?.holdPeer(peerId).catch(() => undefined) ?? Promise.resolve();
}

/** Lets a peer go once its payment is over, one way or the other. */
export function releaseProximityPeer(peerId: string): Promise<void> {
  return module()?.releasePeer(peerId).catch(() => undefined) ?? Promise.resolve();
}

/**
 * Everything arriving over the radio, whichever half of the conversation this
 * phone is. Screens subscribe to the kinds they are waiting for.
 */
export type ProximityMessage = {
  peerId: string;
  kind: OfflineSessionKind;
  payload: string;
  /** Only meaningful on a request: whether the phones were being held together. */
  touching: boolean;
};

export function subscribeToProximityMessages(
  handler: (message: ProximityMessage) => void,
): () => void {
  const native = module();
  if (!native) return () => undefined;
  const emitter = new NativeEventEmitter(NativeModules.RosaPayProximity);
  const subscription = emitter.addListener(MESSAGE_EVENT, (event: RawMessage | undefined) => {
    const message = readMessage(event);
    if (message) handler(message);
  });
  return () => subscription.remove();
}

type RawMessage = {peerId?: unknown; kind?: unknown; payload?: unknown; touching?: unknown};

/**
 * Normalized here so a native build that predates a field, or a peer speaking a
 * later dialect of the conversation, is dropped rather than half-read.
 */
function readMessage(event: RawMessage | undefined): ProximityMessage | null {
  if (typeof event?.payload !== 'string' || !event.payload) return null;
  if (typeof event.peerId !== 'string' || !event.peerId) return null;
  if (typeof event.kind !== 'number') return null;
  const kind = offlineSessionKindOf(event.kind);
  if (!kind) return null;
  return {peerId: event.peerId, kind, payload: event.payload, touching: event.touching === true};
}

/**
 * A request, and whether the two phones were being held together when it was
 * read. The radio cannot prove intent the way a tap can, so native reports what
 * the signal said and the screen decides how far to take it.
 */
export type ProximityRequest = {
  payload: string;
  touching: boolean;
  /**
   * The merchant that sent it, for as long as the two phones stay connected.
   * Everything the customer says back — who is paying, and later the signature
   * — is addressed to this.
   */
  peerId: string;
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
    emitter.addListener(MESSAGE_EVENT, (event: RawMessage | undefined) => {
      const message = readMessage(event);
      // Only the opening message opens a screen. The rest of the conversation
      // belongs to the payment already on it.
      if (message?.kind === 'request') {
        handlers.onRequest({payload: message.payload, touching: message.touching, peerId: message.peerId});
      }
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
