import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState} from 'react-native';
import {NFC_AUTO_AUTHORIZATION_DELAY_MS, useNfcAutoAuthorization} from '../src/features/payments/useNfcAutoAuthorization';

function Harness(props: Parameters<typeof useNfcAutoAuthorization>[0]) {
  useNfcAutoAuthorization(props);
  return null;
}

describe('NFC auto-authorization', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('cancels the delayed authorization when the app leaves the foreground', () => {
    const authorize = jest.fn();
    let onChange!: (state: 'active' | 'background') => void;
    const addListener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      onChange = listener as (state: 'active' | 'background') => void;
      return {remove: jest.fn()} as never;
    });
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <Harness intentId="intent-background" transport="nfc" ready authorize={authorize} />,
      );
    });

    ReactTestRenderer.act(() => onChange('background'));
    ReactTestRenderer.act(() => jest.advanceTimersByTime(NFC_AUTO_AUTHORIZATION_DELAY_MS));
    expect(authorize).not.toHaveBeenCalled();

    ReactTestRenderer.act(() => renderer.unmount());
    addListener.mockRestore();
  });

  it('starts one device authorization after a valid NFC request is ready', () => {
    const authorize = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <Harness intentId="intent-nfc" transport="nfc" ready authorize={authorize} />,
      );
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(NFC_AUTO_AUTHORIZATION_DELAY_MS - 1));
    expect(authorize).not.toHaveBeenCalled();

    ReactTestRenderer.act(() => jest.advanceTimersByTime(1));
    expect(authorize).toHaveBeenCalledTimes(1);

    ReactTestRenderer.act(() => {
      renderer.update(<Harness intentId="intent-nfc" transport="nfc" ready authorize={authorize} />);
      jest.advanceTimersByTime(NFC_AUTO_AUTHORIZATION_DELAY_MS);
    });
    expect(authorize).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('never auto-authorizes QR requests', () => {
    const authorize = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <Harness intentId="intent-qr" transport="qr" ready authorize={authorize} />,
      );
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(NFC_AUTO_AUTHORIZATION_DELAY_MS));
    expect(authorize).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('waits until all payment checks are ready', () => {
    const authorize = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <Harness intentId="intent-later" transport="nfc" ready={false} authorize={authorize} />,
      );
      jest.advanceTimersByTime(NFC_AUTO_AUTHORIZATION_DELAY_MS);
    });
    expect(authorize).not.toHaveBeenCalled();

    ReactTestRenderer.act(() => renderer.update(<Harness intentId="intent-later" transport="nfc" ready authorize={authorize} />));
    ReactTestRenderer.act(() => jest.advanceTimersByTime(NFC_AUTO_AUTHORIZATION_DELAY_MS));
    expect(authorize).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });
});
