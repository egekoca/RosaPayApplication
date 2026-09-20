import {NativeModules, Platform} from 'react-native';
import {
  getProximityStatus,
  sendProximityMessage,
  startProximityBroadcast,
  startProximityScanner,
  subscribeToProximityMessages,
} from '../src/native/nativeProximity';

const startScanning = jest.fn().mockResolvedValue(undefined);
const stopScanning = jest.fn().mockResolvedValue(undefined);
const startBroadcast = jest.fn().mockResolvedValue(undefined);
const stopBroadcast = jest.fn().mockResolvedValue(undefined);
const requestPermissions = jest.fn().mockResolvedValue(undefined);
const sendMessage = jest.fn().mockResolvedValue(undefined);
const holdPeer = jest.fn().mockResolvedValue(undefined);
const releasePeer = jest.fn().mockResolvedValue(undefined);
const getStatus = jest
  .fn()
  .mockResolvedValue({supported: true, enabled: true, authorized: true, canBroadcast: true});

const mockListeners: Record<string, ((value: string) => void) | undefined> = {};

jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    addListener: (event: string, handler: (value: string) => void) => {
      mockListeners[event] = handler;
      return {remove: () => delete mockListeners[event]};
    },
  })),
}));

describe('the Bluetooth proximity transport', () => {
  beforeEach(() => {
    Object.keys(mockListeners).forEach(key => delete mockListeners[key]);
    jest.clearAllMocks();
    Platform.OS = 'ios';
    NativeModules.RosaPayProximity = {
      getStatus,
      requestPermissions,
      startBroadcast,
      stopBroadcast,
      startScanning,
      stopScanning,
      sendMessage,
      holdPeer,
      releasePeer,
    };
  });

  it('hands a nearby merchant request to the caller, with what the signal said', () => {
    const onRequest = jest.fn();
    const stop = startProximityScanner({onRequest, onError: jest.fn()});

    mockListeners.RosaPayProximityMessage!({
      peerId: 'merchant-1',
      kind: 1,
      payload: 'rosapay://pay/abc',
      touching: true,
    } as never);
    expect(onRequest).toHaveBeenCalledWith({
      payload: 'rosapay://pay/abc',
      touching: true,
      peerId: 'merchant-1',
    });

    stop();
    expect(stopScanning).toHaveBeenCalled();
  });

  it('never reads a missing proximity verdict as phones being held together', () => {
    // A native build that predates the verdict says nothing, and silence must
    // not become the reading that lets a payment prompt start by itself.
    const onRequest = jest.fn();
    startProximityScanner({onRequest, onError: jest.fn()});

    mockListeners.RosaPayProximityMessage!({
      peerId: 'merchant-1',
      kind: 1,
      payload: 'rosapay://pay/abc',
    } as never);
    expect(onRequest).toHaveBeenCalledWith({
      payload: 'rosapay://pay/abc',
      touching: false,
      peerId: 'merchant-1',
    });
  });

  it('drops an event carrying no request at all', () => {
    const onRequest = jest.fn();
    startProximityScanner({onRequest, onError: jest.fn()});

    mockListeners.RosaPayProximityMessage!({peerId: 'merchant-1', kind: 1, touching: true} as never);
    mockListeners.RosaPayProximityMessage!({kind: 1, payload: 'rosapay://pay/abc'} as never);
    mockListeners.RosaPayProximityMessage!(undefined as never);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('opens a screen only for the request, never for the rest of the conversation', () => {
    // The messages that follow belong to a payment already in front of someone.
    // Treated as arrivals they would take the screen back mid-approval.
    const onRequest = jest.fn();
    startProximityScanner({onRequest, onError: jest.fn()});

    mockListeners.RosaPayProximityMessage!({
      peerId: 'merchant-1',
      kind: 3,
      payload: '{"v":"RTP/1"}',
    } as never);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('carries the offline conversation to the peer it belongs to', async () => {
    await sendProximityMessage('merchant-1', 'payer', '{"v":"RTP/1"}');
    expect(sendMessage).toHaveBeenCalledWith('merchant-1', 2, '{"v":"RTP/1"}');
  });

  it('names each message by kind, and drops a dialect it does not know', () => {
    const onMessage = jest.fn();
    const stop = subscribeToProximityMessages(onMessage);

    mockListeners.RosaPayProximityMessage!({
      peerId: 'customer-1',
      kind: 4,
      payload: '{"v":"RTP/1"}',
    } as never);
    expect(onMessage).toHaveBeenCalledWith({
      peerId: 'customer-1',
      kind: 'authorization',
      payload: '{"v":"RTP/1"}',
      touching: false,
    });

    onMessage.mockClear();
    mockListeners.RosaPayProximityMessage!({
      peerId: 'customer-1',
      kind: 99,
      payload: '{}',
    } as never);
    expect(onMessage).not.toHaveBeenCalled();

    stop();
  });

  it('reports a scanner that could not start, rather than looking armed', () => {
    const onError = jest.fn();
    startProximityScanner({onRequest: jest.fn(), onError});

    mockListeners.RosaPayProximityError!('Bluetooth could not look for a nearby merchant');
    expect(onError).toHaveBeenCalledWith('Bluetooth could not look for a nearby merchant');
  });

  it('stops listening once the caller lets go, even after an error', () => {
    const onRequest = jest.fn();
    const stop = startProximityScanner({onRequest, onError: jest.fn()});
    stop();

    // The subscription is gone, so a late native event reaches nobody.
    expect(mockListeners.RosaPayProximityMessage).toBeUndefined();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('never reads a missing field as readiness', async () => {
    // A native build that predates a field returns undefined for it, and a
    // screen that believed that would offer a transport this phone lacks.
    getStatus.mockResolvedValueOnce({supported: true});
    await expect(getProximityStatus()).resolves.toEqual({
      supported: true,
      enabled: false,
      authorized: false,
      canBroadcast: false,
    });
  });

  it('treats a native failure as no Bluetooth at all', async () => {
    getStatus.mockRejectedValueOnce(new Error('bridge is gone'));
    await expect(getProximityStatus()).resolves.toEqual({
      supported: false,
      enabled: false,
      authorized: false,
      canBroadcast: false,
    });
  });

  it('surfaces a device that refuses to advertise, so the QR stays the answer', async () => {
    startBroadcast.mockRejectedValueOnce(new Error('BLE_DISABLED'));
    await expect(startProximityBroadcast('rosapay://pay/abc')).rejects.toThrow('BLE_DISABLED');
  });

  it('does nothing at all where the native module is absent', () => {
    NativeModules.RosaPayProximity = undefined;
    const onRequest = jest.fn();
    const stop = startProximityScanner({onRequest, onError: jest.fn()});

    expect(startScanning).not.toHaveBeenCalled();
    // The caller still gets a stopper, so no screen has to guard its cleanup.
    expect(() => stop()).not.toThrow();
  });
});
