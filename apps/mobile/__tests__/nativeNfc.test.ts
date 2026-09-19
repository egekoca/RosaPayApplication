import {NativeModules, Platform} from 'react-native';
import {getNfcStatus, startNfcBroadcast, startNfcReader} from '../src/native/nativeNfc';

const startReading = jest.fn().mockResolvedValue(undefined);
const stopReading = jest.fn().mockResolvedValue(undefined);
const startBroadcast = jest.fn().mockResolvedValue(undefined);
const stopBroadcast = jest.fn().mockResolvedValue(undefined);
const getStatus = jest.fn().mockResolvedValue({supported: true, enabled: true, canBroadcast: true});

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

describe('the NFC transport', () => {
  beforeEach(() => {
    Object.keys(mockListeners).forEach(key => delete mockListeners[key]);
    jest.clearAllMocks();
    Platform.OS = 'android';
    NativeModules.RosaPayNfc = {getStatus, startBroadcast, stopBroadcast, startReading, stopReading};
  });

  it('hands a tapped request to the caller', async () => {
    const onRequest = jest.fn();
    const stop = startNfcReader({onRequest, onError: jest.fn()});

    mockListeners.RosaPayNfcRequestRead!('rosapay://pay/abc');
    expect(onRequest).toHaveBeenCalledWith('rosapay://pay/abc');

    stop();
    expect(stopReading).toHaveBeenCalled();
  });

  it('reports a tap that ended early instead of failing silently', () => {
    const onError = jest.fn();
    startNfcReader({onRequest: jest.fn(), onError});

    mockListeners.RosaPayNfcError!('Hold the phones together until the request is read');
    expect(onError).toHaveBeenCalledWith('Hold the phones together until the request is read');
  });

  it('stops listening once the caller stops, so a later tap is ignored', () => {
    const onRequest = jest.fn();
    const stop = startNfcReader({onRequest, onError: jest.fn()});
    stop();
    expect(mockListeners.RosaPayNfcRequestRead).toBeUndefined();
  });

  it('reports NFC as unavailable on iOS, which cannot emulate a card', async () => {
    Platform.OS = 'ios';
    await expect(getNfcStatus()).resolves.toEqual({
      supported: false,
      enabled: false,
      canBroadcast: false,
    });
    // The caller still gets a stopper it can call safely.
    expect(() => startNfcReader({onRequest: jest.fn(), onError: jest.fn()})()).not.toThrow();
    expect(startReading).not.toHaveBeenCalled();
  });

  it('survives a device that refuses to broadcast', async () => {
    startBroadcast.mockRejectedValueOnce(new Error('NFC_DISABLED'));
    await expect(startNfcBroadcast('rosapay://pay/abc')).resolves.toBeUndefined();
  });
});
