import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState} from 'react-native';
import type {ProximityStatus} from '../src/native/nativeProximity';
import {useProximityStatus} from '../src/features/payments/useProximity';

const mockNative = {
  getProximityStatus: jest.fn(),
  requestProximityPermissions: jest.fn(),
};

jest.mock('../src/native/nativeProximity', () => ({
  proximityUnavailable: {supported: false, enabled: false, authorized: false, canBroadcast: false},
  getProximityStatus: (...args: unknown[]) => mockNative.getProximityStatus(...args),
  requestProximityPermissions: (...args: unknown[]) => mockNative.requestProximityPermissions(...args),
  startProximityBroadcast: jest.fn(),
  startProximityScanner: jest.fn(),
  stopProximityBroadcast: jest.fn(),
}));

const granted = {supported: true, enabled: true, authorized: true, canBroadcast: true};
const notAsked = {...granted, authorized: false};

describe('one answer about the radio, shared by every screen that asks', () => {
  beforeEach(() => {
    Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  });

  it('carries a grant given on one screen to every other screen', async () => {
    /*
     * The home screen is the one place that offers Bluetooth as a button, and
     * it holds no scanner. While each caller kept a copy of its own, that grant
     * reached the button's copy alone: the row congratulated itself and
     * disappeared while the scanner, still holding "not allowed", stayed off.
     * The customer had answered the only prompt they would ever be shown, and
     * nothing happened — with the control that explained it now gone.
     */
    mockNative.getProximityStatus.mockResolvedValue(notAsked);
    mockNative.requestProximityPermissions.mockResolvedValue(granted);

    let allow!: () => void;
    let elsewhere: ProximityStatus | undefined;
    function Button() {
      allow = useProximityStatus().request;
      return null;
    }
    function OtherScreen() {
      elsewhere = useProximityStatus();
      return null;
    }

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <>
          <Button />
          <OtherScreen />
        </>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(elsewhere?.authorized).toBe(false);

    await ReactTestRenderer.act(async () => {
      allow();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The screen that never asked now knows, because there is only one answer.
    expect(elsewhere?.authorized).toBe(true);
  });
});
