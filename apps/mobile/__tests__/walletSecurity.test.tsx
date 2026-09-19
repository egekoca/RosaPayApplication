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
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

async function render(navigation?: {navigate: jest.Mock}) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<WalletScreen navigation={navigation} />);
  });
  renderers.push(renderer);
  return renderer;
}

describe('the wallet screen', () => {
  beforeEach(() => {
    ReactTestRenderer.act(() => {
      useAppStore.setState({...initial, account: null, smartWallet: null, wallet: null, locked: false});
    });
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      for (const renderer of renderers.splice(0)) renderer.unmount();
    });
  });

  it('does not claim a key that does not exist', async () => {
    const renderer = await render();
    const rows = renderer.root.findAllByProps({satisfied: false});
    // The unsatisfied row used to carry the same green tick as a satisfied one,
    // telling someone with no key that their funds were protected by it.
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('No wallet on this phone yet');
  });

  it('marks the key satisfied once the phone has a wallet', async () => {
    ReactTestRenderer.act(() => {
      useAppStore.setState({smartWallet: {
        contractId: 'CBI3H4ROVXGJG3BRPABD2TKSIME2VJCJTKEMOCJNF3BNHYJOBK6U57NS',
        devicePublicKey: 'A'.repeat(64),
      }});
    });
    const renderer = await render();
    expect(renderer.root.findAllByProps({satisfied: false})).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Asked for at every payment');
  });

  it('states the actual hardware-backed signing boundary', async () => {
    ReactTestRenderer.act(() => {
      useAppStore.setState({smartWallet: {
        contractId: 'CBI3H4ROVXGJG3BRPABD2TKSIME2VJCJTKEMOCJNF3BNHYJOBK6U57NS',
        devicePublicKey: 'A'.repeat(64),
      }});
    });
    const renderer = await render();
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('secure hardware');
    expect(rendered).toContain('JavaScript receives only the public key');
  });

  it('opens deposit and withdrawal flows once a wallet exists', async () => {
    ReactTestRenderer.act(() => {
      useAppStore.setState({smartWallet: {
        contractId: 'CBI3H4ROVXGJG3BRPABD2TKSIME2VJCJTKEMOCJNF3BNHYJOBK6U57NS',
        devicePublicKey: 'A'.repeat(64),
      }});
    });
    const navigation = {navigate: jest.fn()};
    const renderer = await render(navigation);

    await ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'add-money'}).props.onPress());
    await ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'withdraw-money'}).props.onPress());

    expect(navigation.navigate).toHaveBeenNthCalledWith(1, 'AnchorTransfer', {kind: 'deposit'});
    expect(navigation.navigate).toHaveBeenNthCalledWith(2, 'AnchorTransfer', {kind: 'withdraw'});
  });

  it('lets a signed-in person lock the app from where their account is shown', async () => {
    useAppStore.getState().createAccount({name: 'Ege Koca', email: 'ege@example.com'});
    // Locking is opt-in: an owner who never asked to be challenged is not.
    useAppStore.getState().setRequireUnlock(true);
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
