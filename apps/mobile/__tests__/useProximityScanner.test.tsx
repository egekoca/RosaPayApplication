import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState} from 'react-native';
import {useProximityScanner, useProximityStatusStore} from '../src/features/payments/useProximity';

const mockNative = {
  getProximityStatus: jest.fn(),
  requestProximityPermissions: jest.fn(),
  startProximityScanner: jest.fn(),
};

jest.mock('../src/native/nativeProximity', () => ({
  proximityUnavailable: {supported: false, enabled: false, authorized: false, canBroadcast: false},
  getProximityStatus: (...args: unknown[]) => mockNative.getProximityStatus(...args),
  requestProximityPermissions: (...args: unknown[]) => mockNative.requestProximityPermissions(...args),
  startProximityScanner: (...args: unknown[]) => mockNative.startProximityScanner(...args),
}));

function Harness({active}: {active: boolean}) {
  useProximityScanner(active, {onRequest: () => undefined, onError: () => undefined});
  return null;
}

async function render(active: boolean) {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<Harness active={active} />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const unavailable = {supported: false, enabled: false, authorized: false, canBroadcast: false};
const granted = {supported: true, enabled: true, authorized: true, canBroadcast: true};
const notAsked = {...granted, authorized: false};

describe('listening for a merchant while the app is open', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
    mockNative.startProximityScanner.mockReturnValue(() => undefined);
    // The status is one shared fact about the device, so it outlives a test.
    ReactTestRenderer.act(() => {
      useProximityStatusStore.setState({status: unavailable});
    });
  });

  it('asks for Bluetooth on the paying side, which nothing else ever did', async () => {
    /*
     * `authorized` is a real grant, never "not asked yet", and raising the
     * prompt is what allocates the managers the radio needs. Only the merchant
     * half asked, so a phone that had never put a request up was never handed
     * the question: the scanner's own gate could not open, it never started,
     * and holding that phone against a merchant's did nothing at all — with no
     * error, because nothing had been attempted.
     */
    mockNative.getProximityStatus.mockResolvedValue(notAsked);
    mockNative.requestProximityPermissions.mockResolvedValue(granted);

    await render(true);

    expect(mockNative.requestProximityPermissions).toHaveBeenCalled();
  });

  it('does not put the prompt up before there is anything to listen for', async () => {
    // Off the paying screens the question has no context, and both platforms
    // ask once — so spending it here would spend it on nothing.
    mockNative.getProximityStatus.mockResolvedValue(notAsked);

    await render(false);

    expect(mockNative.requestProximityPermissions).not.toHaveBeenCalled();
    expect(mockNative.startProximityScanner).not.toHaveBeenCalled();
  });

  it('asks nothing of a phone that has already granted it', async () => {
    mockNative.getProximityStatus.mockResolvedValue(granted);

    await render(true);

    expect(mockNative.requestProximityPermissions).not.toHaveBeenCalled();
    expect(mockNative.startProximityScanner).toHaveBeenCalled();
  });
});
