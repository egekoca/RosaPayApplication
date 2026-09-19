/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {WalletScreen} from '../src/features/wallet/WalletScreen';
import {useAppStore} from '../src/state/appStore';

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

jest.mock('../src/shared/useStellarHealth', () => ({
  useStellarHealth: () => ({data: {latestLedger: 4_300_000, protocolVersion: 27}, isPending: false, isError: false}),
}));

jest.mock('../src/shared/useWalletBalance', () => ({useWalletBalance: () => ({data: undefined})}));

const initial = useAppStore.getState();

async function render(navigation?: {navigate: jest.Mock}) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<WalletScreen navigation={navigation} />);
  });
  return renderer;
}

describe('the wallet screen', () => {
  beforeEach(() => {
    useAppStore.setState({...initial, account: null, smartWallet: null, locked: false});
  });

  it('does not claim a device key that does not exist', async () => {
    const renderer = await render();
    const rows = renderer.root.findAllByProps({satisfied: false});
    // The unsatisfied row used to carry the same green tick as a satisfied one,
    // telling someone with no key that their funds were protected by it.
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('No device key yet');
  });

  it('marks the key satisfied once the device has a wallet', async () => {
    useAppStore.setState({smartWallet: {contractId: 'CBI3H4RO', devicePublicKey: 'k'}});
    const renderer = await render();
    expect(renderer.root.findAllByProps({satisfied: false})).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Hardware signer');
  });

  it('opens contract-account deposit and withdrawal flows from a provisioned wallet', async () => {
    useAppStore.setState({smartWallet: {contractId: 'CBI3H4RO', devicePublicKey: 'k'}});
    const navigation = {navigate: jest.fn()};
    const renderer = await render(navigation);

    await ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'add-money'}).props.onPress());
    await ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'withdraw-money'}).props.onPress());

    expect(navigation.navigate).toHaveBeenNthCalledWith(1, 'AnchorTransfer', {kind: 'deposit'});
    expect(navigation.navigate).toHaveBeenNthCalledWith(2, 'AnchorTransfer', {kind: 'withdraw'});
  });

  it('lets a signed-in person lock the app from where their account is shown', async () => {
    useAppStore.getState().createAccount({name: 'Ege Koca', email: 'ege@example.com'});
    const renderer = await render();

    expect(JSON.stringify(renderer.toJSON())).toContain('Ege Koca');
    await ReactTestRenderer.act(() => {
      renderer.root.findByProps({testID: 'lock-now'}).props.onPress();
    });
    expect(useAppStore.getState().locked).toBe(true);
  });

  it('asks twice before erasing an account', async () => {
    useAppStore.getState().createAccount({name: 'Ege'});
    const renderer = await render();
    const signOut = () => renderer.root.findByProps({testID: 'wallet-sign-out'});

    await ReactTestRenderer.act(() => signOut().props.onPress());
    expect(useAppStore.getState().account).not.toBeNull();

    await ReactTestRenderer.act(() => signOut().props.onPress());
    expect(useAppStore.getState().account).toBeNull();
  });
});
