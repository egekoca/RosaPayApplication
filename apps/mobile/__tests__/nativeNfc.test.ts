import {NativeModules, Platform} from 'react-native';
import {getNfcStatus, startNfcBroadcast, startNfcReader} from '../src/native/nativeNfc';

const startReading = jest.fn().mockResolvedValue(undefined);
const stopReading = jest.fn().mockResolvedValue(undefined);
const startBroadcast = jest.fn().mockResolvedValue(undefined);
const stopBroadcast = jest.fn().mockResolvedValue(undefined);
const getStatus = jest
  .fn()
  .mockResolvedValue({supported: true, enabled: true, canBroadcast: true, needsUserAction: false});

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

  it('lets an iPhone read a tap, but never publish one', async () => {
    Platform.OS = 'ios';
    // What RosaPayNfc.swift reports: reading is available, emulating a card is
    // not, and the reader needs a deliberate press because it is a system sheet.
    getStatus.mockResolvedValueOnce({
      supported: true,
      enabled: true,
      canBroadcast: false,
      needsUserAction: true,
    });

    await expect(getNfcStatus()).resolves.toEqual({
      supported: true,
      enabled: true,
      canBroadcast: false,
      needsUserAction: true,
    });

    const onRequest = jest.fn();
    const stop = startNfcReader({onRequest, onError: jest.fn()});
    expect(startReading).toHaveBeenCalled();

    mockListeners.RosaPayNfcRequestRead!('rosapay://pay/abc');
    expect(onRequest).toHaveBeenCalledWith('rosapay://pay/abc');
    stop();
  });

  it('reports NFC as unavailable where there is no native module at all', async () => {
    // A simulator, or a platform this app was never built for.
    Platform.OS = 'web' as typeof Platform.OS;
    await expect(getNfcStatus()).resolves.toEqual({
      supported: false,
      enabled: false,
      canBroadcast: false,
      needsUserAction: false,
    });
    // The caller still gets a stopper it can call safely.
    expect(() => startNfcReader({onRequest: jest.fn(), onError: jest.fn()})()).not.toThrow();
    expect(startReading).not.toHaveBeenCalled();
  });

  it('treats a field a older native build never sent as not ready', async () => {
    // An app store build predating `needsUserAction` must not have it read as
    // true by accident, which would hide the Android tap hint.
    getStatus.mockResolvedValueOnce({supported: true, enabled: true, canBroadcast: true});
    await expect(getNfcStatus()).resolves.toEqual({
      supported: true,
      enabled: true,
      canBroadcast: true,
      needsUserAction: false,
    });
  });

  it('surfaces a device that refuses to broadcast', async () => {
    startBroadcast.mockRejectedValueOnce(new Error('NFC_DISABLED'));
    await expect(startNfcBroadcast('rosapay://pay/abc')).rejects.toThrow('NFC_DISABLED');
  });

  it('surfaces that an iPhone cannot broadcast while leaving QR available', async () => {
    Platform.OS = 'ios';
    startBroadcast.mockRejectedValueOnce(new Error('iPhone cannot share a request over NFC'));
    await expect(startNfcBroadcast('rosapay://pay/abc')).rejects.toThrow('iPhone cannot share a request over NFC');
  });
});
