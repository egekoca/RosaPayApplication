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

test('offers one way into the app, in words a customer would use', async () => {
  const Screen = WelcomeScreen as unknown as React.ComponentType<{
    navigation: {navigate: jest.Mock};
  }>;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Screen navigation={{navigate: jest.fn()}} />);
  });
  const tree = JSON.stringify(renderer!.toJSON());

  expect(tree).toContain('Pay by scanning.');
  expect(tree).toContain('Get started');

  // The screen used to offer "Create your wallet" and "Sign in with passkey"
  // side by side. Both did exactly the same thing, and neither told a customer
  // which one was theirs.
  expect(tree).not.toContain('passkey');
  expect(tree).not.toContain('Create your wallet');
});
