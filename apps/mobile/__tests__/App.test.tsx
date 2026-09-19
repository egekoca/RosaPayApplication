/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {WelcomeScreen} from '../src/features/onboarding/WelcomeScreen';

jest.mock('react-native-qrcode-svg', () => 'QRCode');
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

test('renders the Rosa Pay onboarding screen', async () => {
  const Screen = WelcomeScreen as unknown as React.ComponentType<{
    navigation: {replace: jest.Mock};
  }>;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Screen navigation={{replace: jest.fn()}} />);
  });
  const tree = JSON.stringify(renderer!.toJSON());
  expect(tree).toContain('Payments that feel certain.');
  expect(tree).toContain('Create your wallet');
});
