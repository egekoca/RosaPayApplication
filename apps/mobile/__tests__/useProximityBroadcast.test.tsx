import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState} from 'react-native';
import {
  useProximityBroadcast,
  useProximityStatusStore,
  type ProximityBroadcastStatus,
} from '../src/features/payments/useProximity';

const mockNative = {
  getProximityStatus: jest.fn(),
  requestProximityPermissions: jest.fn(),
  startProximityBroadcast: jest.fn(),
  stopProximityBroadcast: jest.fn(),
};

jest.mock('../src/native/nativeProximity', () => ({
  proximityUnavailable: {supported: false, enabled: false, authorized: false, canBroadcast: false},
  getProximityStatus: (...args: unknown[]) => mockNative.getProximityStatus(...args),
  requestProximityPermissions: (...args: unknown[]) => mockNative.requestProximityPermissions(...args),
  startProximityBroadcast: (...args: unknown[]) => mockNative.startProximityBroadcast(...args),
  stopProximityBroadcast: (...args: unknown[]) => mockNative.stopProximityBroadcast(...args),
}));

let observed: ProximityBroadcastStatus | undefined;
function Harness({payload}: {payload: string | null}) {
  observed = useProximityBroadcast(payload);
  return null;
}

async function render(payload: string | null) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<Harness payload={payload} />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

const granted = {supported: true, enabled: true, authorized: true, canBroadcast: true};
const notAsked = {...granted, authorized: false};

describe('offering a request over Bluetooth at the counter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
    // The status is one shared fact about the device, so it outlives a test.
    ReactTestRenderer.act(() => {
      useProximityStatusStore.setState({
        status: {supported: false, enabled: false, authorized: false, canBroadcast: false},
      });
    });
    observed = undefined;
    mockNative.startProximityBroadcast.mockResolvedValue(undefined);
    mockNative.stopProximityBroadcast.mockResolvedValue(undefined);
    mockNative.requestProximityPermissions.mockResolvedValue(granted);
  });

  it('asks for Bluetooth the moment there is a request to offer', async () => {
    // A counter should not have to find a button before it can be paid. Being
    // handed a payload is the whole context the question needs.
    mockNative.getProximityStatus.mockResolvedValue(notAsked);
    const renderer = await render('rosapay://pay/abc');

    expect(mockNative.requestProximityPermissions).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('asks nothing while there is nothing to offer', async () => {
    // Asking at launch would be a wallet asking about Bluetooth before anyone
    // had tried to buy anything.
    mockNative.getProximityStatus.mockResolvedValue(notAsked);
    const renderer = await render(null);

    expect(mockNative.requestProximityPermissions).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('does not ask again once the question has been answered', async () => {
    mockNative.getProximityStatus.mockResolvedValue(granted);
    const renderer = await render('rosapay://pay/abc');

    expect(mockNative.requestProximityPermissions).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('goes on the air beside the QR without anyone pressing anything', async () => {
    mockNative.getProximityStatus.mockResolvedValue(granted);
    const renderer = await render('rosapay://pay/abc');

    expect(mockNative.startProximityBroadcast).toHaveBeenCalledWith('rosapay://pay/abc');
    expect(observed?.broadcasting).toBe(true);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('leaves the QR working when Bluetooth refuses', async () => {
    mockNative.getProximityStatus.mockResolvedValue(granted);
    mockNative.startProximityBroadcast.mockRejectedValue(new Error('BLE_DISABLED'));
    const renderer = await render('rosapay://pay/abc');

    expect(observed?.broadcasting).toBe(false);
    expect(observed?.broadcastError).toContain('BLE_DISABLED');
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('stops offering a request that is no longer payable', async () => {
    mockNative.getProximityStatus.mockResolvedValue(granted);
    const renderer = await render('rosapay://pay/abc');

    await ReactTestRenderer.act(async () => {
      renderer.update(<Harness payload={null} />);
      await Promise.resolve();
    });

    expect(mockNative.stopProximityBroadcast).toHaveBeenCalled();
    expect(observed?.broadcasting).toBe(false);
    ReactTestRenderer.act(() => renderer.unmount());
  });
});
