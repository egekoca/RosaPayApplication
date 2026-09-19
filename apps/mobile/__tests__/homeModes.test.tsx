import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {HomeScreen} from '../src/features/home/HomeScreen';
import {useAppStore} from '../src/state/appStore';

jest.mock('../src/shared/Screen', () => ({
  Screen: ({children}: {children: React.ReactNode}) => <>{children}</>,
}));
jest.mock('../src/shared/LumenadeMark', () => ({LumenadeMark: () => null}));
jest.mock('../src/shared/useWalletBalance', () => ({
  useWalletBalance: () => ({data: [{code: 'XLM', amount: '12'}], isPending: false, isError: false}),
}));
jest.mock('../src/shared/useBalanceValue', () => ({useBalanceValue: () => ({data: undefined})}));
jest.mock('../src/features/wallet/currentAccount', () => ({
  useCurrentAccount: () => ({address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', kind: 'classic'}),
}));
jest.mock('../src/features/merchant/merchantRequestStatus', () => ({
  useMerchantPayments: () => ({data: {payments: []}, isSuccess: true, isPending: false, isError: false}),
}));
jest.mock('../src/features/home/CurrencyPicker', () => ({CurrencyPicker: () => null}));
jest.mock('../src/shared/shareAddress', () => ({shareValue: jest.fn()}));
jest.mock('../src/features/wallet/stellarKey', () => ({generateRecoveryPhrase: () => []}));
jest.mock('../src/features/home/PaymentCard', () => {
  const ReactModule = require('react');
  const {View: NativeView} = require('react-native');
  return {PaymentCard: () => ReactModule.createElement(NativeView, {testID: 'shared-balance-card'})};
});

const initial = useAppStore.getState();
const merchantProfile = {
  merchantProfileId: 'merchant-1',
  displayName: 'Lemon Stand',
  recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  signingKey: 'public-key',
  network: 'testnet' as const,
  developmentSigningSecret: Uint8Array.from(Buffer.alloc(32, 7)),
};

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    useAppStore.setState(initial, true);
  });
});

it.each(['customer', 'merchant'] as const)('renders the shared balance card in %s mode', async mode => {
  await ReactTestRenderer.act(() => {
    useAppStore.setState({
      account: {name: 'Ege', createdAt: '2026-01-01T00:00:00.000Z'},
      merchantProfile,
      mode,
    });
  });

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <HomeScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />,
    );
  });

  const rendered = JSON.stringify(renderer.toJSON());
  expect(rendered.match(/shared-balance-card/g)).toHaveLength(1);
  expect(rendered).toContain(mode === 'customer' ? 'Scan to pay' : 'Create payment request');
});
