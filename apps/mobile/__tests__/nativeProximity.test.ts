import {NativeModules, Platform} from 'react-native';
import {
  getProximityStatus,
  startProximityBroadcast,
  startProximityScanner,
} from '../src/native/nativeProximity';

const startScanning = jest.fn().mockResolvedValue(undefined);
const stopScanning = jest.fn().mockResolvedValue(undefined);
const startBroadcast = jest.fn().mockResolvedValue(undefined);
const stopBroadcast = jest.fn().mockResolvedValue(undefined);
const requestPermissions = jest.fn().mockResolvedValue(undefined);
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
    };
  });

  it('hands a nearby merchant request to the caller, with what the signal said', () => {
    const onRequest = jest.fn();
    const stop = startProximityScanner({onRequest, onError: jest.fn()});

    mockListeners.RosaPayProximityRequestRead!({
      payload: 'rosapay://pay/abc',
      touching: true,
    } as never);
    expect(onRequest).toHaveBeenCalledWith({payload: 'rosapay://pay/abc', touching: true});

    stop();
    expect(stopScanning).toHaveBeenCalled();
  });

  it('never reads a missing proximity verdict as phones being held together', () => {
    // A native build that predates the verdict says nothing, and silence must
    // not become the reading that lets a payment prompt start by itself.
    const onRequest = jest.fn();
    startProximityScanner({onRequest, onError: jest.fn()});

    mockListeners.RosaPayProximityRequestRead!({payload: 'rosapay://pay/abc'} as never);
    expect(onRequest).toHaveBeenCalledWith({payload: 'rosapay://pay/abc', touching: false});
  });

  it('drops an event carrying no request at all', () => {
    const onRequest = jest.fn();
    startProximityScanner({onRequest, onError: jest.fn()});

    mockListeners.RosaPayProximityRequestRead!({touching: true} as never);
    mockListeners.RosaPayProximityRequestRead!(undefined as never);
    expect(onRequest).not.toHaveBeenCalled();
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
    expect(mockListeners.RosaPayProximityRequestRead).toBeUndefined();
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
