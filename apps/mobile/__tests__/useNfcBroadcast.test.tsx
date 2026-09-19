import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState} from 'react-native';
import {useNfcBroadcast, type NfcBroadcastStatus} from '../src/features/payments/useNfc';

const mockNativeNfc = {
  getNfcStatus: jest.fn(),
  startNfcBroadcast: jest.fn(),
  stopNfcBroadcast: jest.fn(),
};

jest.mock('../src/native/nativeNfc', () => ({
  nfcUnavailable: {supported: false, enabled: false, canBroadcast: false, needsUserAction: false},
  getNfcStatus: (...args: unknown[]) => mockNativeNfc.getNfcStatus(...args),
  startNfcBroadcast: (...args: unknown[]) => mockNativeNfc.startNfcBroadcast(...args),
  stopNfcBroadcast: (...args: unknown[]) => mockNativeNfc.stopNfcBroadcast(...args),
}));

let observed: NfcBroadcastStatus | undefined;
function Harness({payload}: {payload: string | null}) {
  observed = useNfcBroadcast(payload);
  return null;
}

async function render(payload: string) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<Harness payload={payload} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe('merchant NFC broadcast state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
    observed = undefined;
    mockNativeNfc.getNfcStatus.mockResolvedValue({
      supported: true,
      enabled: true,
      canBroadcast: true,
      needsUserAction: false,
    });
    mockNativeNfc.startNfcBroadcast.mockResolvedValue(undefined);
    mockNativeNfc.stopNfcBroadcast.mockResolvedValue(undefined);
  });

  it('reports ready only after native HCE has accepted the request', async () => {
    const renderer = await render('rosapay://pay/abc');
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(mockNativeNfc.startNfcBroadcast).toHaveBeenCalledWith('rosapay://pay/abc');
    expect(observed?.broadcasting).toBe(true);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('keeps the QR fallback and exposes HCE failure with an explicit retry', async () => {
    mockNativeNfc.startNfcBroadcast
      .mockRejectedValueOnce(new Error('NFC_DISABLED'))
      .mockResolvedValueOnce(undefined);
    const renderer = await render('rosapay://pay/abc');
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(observed?.broadcasting).toBe(false);
    expect(observed?.broadcastError).toBe('NFC_DISABLED');
    ReactTestRenderer.act(() => observed?.retry());
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
    expect(mockNativeNfc.startNfcBroadcast).toHaveBeenCalledTimes(2);
    expect(observed?.broadcasting).toBe(true);
    ReactTestRenderer.act(() => renderer.unmount());
  });
});
