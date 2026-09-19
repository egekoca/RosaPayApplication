/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {encodePaymentQr} from '@rosapay/protocol';
import {ScanScreen} from '../src/features/payments/ScanScreen';
import {mockSignedIntent} from '../src/features/payments/mockIntent';

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const {View} = require('react-native');
  const insets = {top: 0, right: 0, bottom: 0, left: 0};
  return {
    initialWindowMetrics: null,
    SafeAreaInsetsContext: ReactModule.createContext(insets),
    SafeAreaProvider: ({children}: {children: React.ReactNode}) =>
      ReactModule.createElement(View, null, children),
    SafeAreaView: ({children}: {children: React.ReactNode}) =>
      ReactModule.createElement(View, null, children),
    useSafeAreaInsets: () => insets,
  };
});

jest.mock('../src/features/payments/cameraPermission', () => ({
  requestCameraPermission: jest.fn().mockResolvedValue('granted'),
}));

jest.mock('../src/shared/useStellarHealth', () => ({
  useStellarHealth: () => ({data: {latestLedger: 1_500_000}}),
}));

type Navigation = {navigate: jest.Mock; addListener: jest.Mock};

function navigation(): Navigation {
  return {navigate: jest.fn(), addListener: jest.fn().mockReturnValue(jest.fn())};
}

async function renderScanner(nav: Navigation) {
  const Screen = ScanScreen as unknown as React.ComponentType<{navigation: Navigation}>;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Screen navigation={nav} />);
  });
  // Let the camera-permission promise settle before the test drives the camera.
  await ReactTestRenderer.act(async () => {});
  return renderer;
}

/** Drives the camera the way a real read does: one event per frame in view. */
async function read(renderer: ReactTestRenderer.ReactTestRenderer, value: string) {
  const camera = renderer.root.findByProps({testID: 'scan-camera'});
  await ReactTestRenderer.act(() => {
    camera.props.onReadCode({nativeEvent: {codeStringValue: value, codeFormat: 'qr'}});
  });
}

describe('the scanner', () => {
  it('opens the confirmation for a merchant-signed request the camera read', async () => {
    const nav = navigation();
    const renderer = await renderScanner(nav);

    await read(renderer, encodePaymentQr(mockSignedIntent));

    expect(nav.navigate).toHaveBeenCalledWith('Confirm', {payload: mockSignedIntent});
  });

  it('confirms once even though the camera keeps reading the same code', async () => {
    const nav = navigation();
    const renderer = await renderScanner(nav);
    const encoded = encodePaymentQr(mockSignedIntent);

    await read(renderer, encoded);
    await read(renderer, encoded);
    await read(renderer, encoded);

    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });

  it('stays on the scanner and explains anything that is not a payment request', async () => {
    const nav = navigation();
    const renderer = await renderScanner(nav);

    await read(renderer, 'https://example.com/menu');

    expect(nav.navigate).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('Unsupported payment QR');
  });

  it('recovers after a bad read, so the next code still pays', async () => {
    const nav = navigation();
    const renderer = await renderScanner(nav);

    await read(renderer, 'rosapay://pay/not-base64-json');
    expect(nav.navigate).not.toHaveBeenCalled();

    await read(renderer, encodePaymentQr(mockSignedIntent));
    expect(nav.navigate).toHaveBeenCalledWith('Confirm', {payload: mockSignedIntent});
  });
});
