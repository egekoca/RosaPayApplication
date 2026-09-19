/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {CreateAccountScreen} from '../src/features/onboarding/CreateAccountScreen';
import {MerchantOnboardingScreen} from '../src/features/merchant/MerchantOnboardingScreen';
import {createHardwareSigner} from '../src/features/settings/hardwareSigner';
import {useAppStore} from '../src/state/appStore';

jest.mock('../src/features/settings/hardwareSigner', () => ({createHardwareSigner: jest.fn()}));
jest.mock('../src/features/merchant/merchantRegistration', () => ({registerMerchantForTestnet: jest.fn()}));
jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const {View} = require('react-native');
  const insets = {top: 0, right: 0, bottom: 0, left: 0};
  return {
    initialWindowMetrics: null,
    SafeAreaInsetsContext: ReactModule.createContext(insets),
    SafeAreaProvider: ({children}: {children: React.ReactNode}) => ReactModule.createElement(View, null, children),
    SafeAreaView: ({children}: {children: React.ReactNode}) => ReactModule.createElement(View, null, children),
    useSafeAreaInsets: () => insets,
  };
});

const mockedCreateHardwareSigner = jest.mocked(createHardwareSigner);
const smartWallet = {
  contractId: 'CAFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUTSM',
  devicePublicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 3)]).toString('base64'),
};
const initial = useAppStore.getState();
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
    useAppStore.setState({...initial, account: null, smartWallet: null, merchantProfile: null});
    await Promise.resolve();
  });
  jest.clearAllMocks();
});

it('does not create a local account when secure wallet provisioning fails', async () => {
  mockedCreateHardwareSigner.mockResolvedValue({
    state: 'ready',
    publicKey: smartWallet.devicePublicKey,
    detail: 'The Testnet wallet could not be provisioned',
  });
  const navigation = {replace: jest.fn()};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <CreateAccountScreen navigation={navigation as never} route={{} as never} />,
    );
  });
  renderers.push(renderer);

  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({testID: 'account-name'}).props.onChangeText('Ege');
  });
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({testID: 'create-account'}).props.onPress();
    await Promise.resolve();
  });

  expect(useAppStore.getState().account).toBeNull();
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('The Testnet wallet could not be provisioned');
});

it('fills the merchant recipient with the production smart-wallet address', async () => {
  await ReactTestRenderer.act(() => {
    useAppStore.setState({smartWallet});
  });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <MerchantOnboardingScreen navigation={{replace: jest.fn()} as never} route={{} as never} />,
    );
  });
  renderers.push(renderer);

  expect(renderer.root.findByProps({testID: 'merchant-recipient'}).props.value).toBe(smartWallet.contractId);

  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({testID: 'merchant-recipient'}).props.onChangeText('');
  });
  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({testID: 'use-this-wallet'}).props.onPress();
  });

  expect(renderer.root.findByProps({testID: 'merchant-recipient'}).props.value).toBe(smartWallet.contractId);
  expect(smartWallet.contractId).toMatch(/^C[A-Z2-7]{55}$/);
});
