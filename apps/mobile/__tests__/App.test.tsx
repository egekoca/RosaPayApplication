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

test('offers the lira-capable wallet path in customer language', async () => {
  const Screen = WelcomeScreen as unknown as React.ComponentType<{
    navigation: {navigate: jest.Mock};
  }>;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Screen navigation={{navigate: jest.fn()}} />);
  });
  const tree = JSON.stringify(renderer!.toJSON());

  expect(tree).toContain('Pay by scanning.');
  expect(tree).toContain('Settle on Stellar.');
  expect(tree).toContain('LUMEN');
  expect(tree).toContain('LEMONADE');
  expect(tree).toContain('Create a new wallet');
  // Someone who already has a Stellar wallet is not made to create a second one
  // to get in.
  expect(tree).toContain('I already have a wallet');

  // And someone whose phone is gone needs a different road entirely: there is
  // nothing for them to type, because the key that controlled their wallet
  // could never leave the handset. A recovery nobody can find is not one.
  expect(tree).toContain('I lost my phone');
  expect(tree).toContain('a passkey brings it back if the phone is lost');

  // The screen used to offer "Create your wallet" and "Sign in with passkey"
  // side by side. Both did exactly the same thing, and neither told a customer
  // which one was theirs.
  expect(tree).not.toContain('Sign in with passkey');
  expect(tree).not.toContain('Create your wallet');
});

test('sends wallet creation to account setup', async () => {
  const Screen = WelcomeScreen as unknown as React.ComponentType<{
    navigation: {navigate: jest.Mock};
  }>;
  const navigate = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Screen navigation={{navigate}} />);
  });

  await ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'get-started'}).props.onPress());
  expect(navigate).toHaveBeenCalledWith('CreateAccount', {intent: 'create'});
});

test('sends someone who already has a wallet to restore it instead', async () => {
  const Screen = WelcomeScreen as unknown as React.ComponentType<{
    navigation: {navigate: jest.Mock};
  }>;
  const navigate = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Screen navigation={{navigate}} />);
  });

  await ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'restore-wallet'}).props.onPress());
  expect(navigate).toHaveBeenCalledWith('CreateAccount', {intent: 'import'});
});
