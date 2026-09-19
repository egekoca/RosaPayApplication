import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {ModeSwitcher} from '../src/shared/ModeSwitcher';
import {useAppStore} from '../src/state/appStore';

const initial = useAppStore.getState();

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    useAppStore.setState(initial, true);
  });
});

it('presents payment capabilities without implying separate wallets or accounts', async () => {
  useAppStore.setState({
    merchantProfile: {
      merchantProfileId: 'merchant-1',
      displayName: 'Lemon Stand',
      recipient: 'CAFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUTSM',
      signingKey: 'public-key',
      network: 'testnet',
      developmentSigningSecret: Uint8Array.from(Buffer.alloc(32, 7)),
    },
    mode: 'customer',
  });

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<ModeSwitcher />);
  });

  const tree = JSON.stringify(renderer.toJSON());
  expect(tree).toContain('Pay');
  expect(tree).toContain('Get paid');
  expect(tree).not.toContain('Wallet mode');
  expect(tree).not.toContain('Merchant mode');

  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({testID: 'mode-merchant'}).props.onPress();
  });
  expect(useAppStore.getState().mode).toBe('merchant');
});
