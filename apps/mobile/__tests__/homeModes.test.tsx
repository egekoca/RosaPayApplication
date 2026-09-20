import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Platform} from 'react-native';
import {HomeScreen} from '../src/features/home/HomeScreen';
import {PaymentCard} from '../src/features/home/PaymentCard';
import {CurrencyPicker} from '../src/features/home/CurrencyPicker';
import {useAppStore} from '../src/state/appStore';

jest.mock('../src/shared/Screen', () => ({
  Screen: ({children}: {children: React.ReactNode}) => <>{children}</>,
}));
jest.mock('../src/shared/RosaMark', () => ({RosaMark: () => null}));
jest.mock('../src/shared/useWalletBalance', () => ({
  useWalletBalance: () => ({
    data: [{code: 'XLM', amount: '12'}, {code: 'USDC', amount: '10000'}],
    isPending: false,
    isError: false,
  }),
}));
jest.mock('../src/shared/useBalanceValue', () => ({useBalanceValue: () => ({data: undefined})}));
// The picker only offers currencies something will quote, so the screen reads
// the quote servers; this test is about modes, not rates.
jest.mock('../src/shared/useCurrencyPrices', () => ({useCurrencyPrices: () => ({data: undefined})}));
jest.mock('../src/features/wallet/currentAccount', () => ({
  useCurrentAccount: () => ({address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', kind: 'classic'}),
}));
jest.mock('../src/features/merchant/merchantRequestStatus', () => ({
  useMerchantPayments: () => ({data: {payments: []}, isSuccess: true, isPending: false, isError: false}),
}));
jest.mock('../src/features/home/CurrencyPicker', () => ({CurrencyPicker: () => null}));
jest.mock('../src/shared/shareAddress', () => ({shareValue: jest.fn()}));
jest.mock('../src/features/wallet/stellarKey', () => ({generateRecoveryPhrase: () => []}));
const mockProximity = {
  supported: true,
  enabled: true,
  authorized: true,
  canBroadcast: true,
  request: jest.fn(),
};
jest.mock('../src/features/payments/useProximity', () => ({
  useProximityStatus: () => mockProximity,
}));
const initial = useAppStore.getState();
let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
const merchantProfile = {
  merchantProfileId: 'merchant-1',
  displayName: 'Lemon Stand', email: 'hello@example.com',
  recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  signingKey: 'public-key',
  network: 'testnet' as const,
  developmentSigningSecret: Uint8Array.from(Buffer.alloc(32, 7)),
};

beforeEach(() => {
  mockProximity.supported = true;
  mockProximity.authorized = true;
  mockProximity.request.mockClear();
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    renderer?.unmount();
    renderer = undefined;
    useAppStore.setState(initial, true);
  });
  jest.restoreAllMocks();
});

it.each(['customer', 'merchant'] as const)('renders the shared balance card in %s mode', async mode => {
  await ReactTestRenderer.act(() => {
    useAppStore.setState({
      account: {name: 'Ege', createdAt: '2026-01-01T00:00:00.000Z'},
      merchantProfile,
      mode,
    });
  });

  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <HomeScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />,
    );
  });

  const rendered = JSON.stringify(renderer!.toJSON());
  expect(renderer!.root.findAllByType(PaymentCard)).toHaveLength(1);
  expect(rendered).toContain(mode === 'customer' ? 'Scan to pay' : 'Create payment request');
  if (mode === 'customer') expect(rendered).toContain('Get paid with this account');
});

it('keeps USDC in Assets when the selected fiat rate is unavailable', async () => {
  await ReactTestRenderer.act(() => {
    useAppStore.setState({account: {name: 'Ege', createdAt: '2026-01-01T00:00:00.000Z'}, mode: 'customer'});
    renderer = ReactTestRenderer.create(
      <HomeScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />,
    );
  });

  const rendered = JSON.stringify(renderer!.toJSON());
  expect(rendered).toContain('Assets');
  expect(rendered).toContain('USD Coin');
  expect(rendered).toContain('10,000');
  expect(rendered).toContain('USDC');
});

it.each(['ios', 'android'] as const)('keeps the card and currency control mounted when switching tasks on %s', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await ReactTestRenderer.act(() => {
    useAppStore.setState({merchantProfile, mode: 'customer'});
    renderer = ReactTestRenderer.create(
      <HomeScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />,
    );
  });
  const card = renderer!.root.findByType(PaymentCard);
  const {address, currency, holdings, state} = card.props;
  await ReactTestRenderer.act(() => card.props.onChangeCurrency());
  expect(renderer!.root.findByType(CurrencyPicker).props.visible).toBe(true);

  await ReactTestRenderer.act(() => {
    renderer!.root.findByProps({testID: 'mode-merchant'}).props.onPress();
  });
  expect(renderer!.root.findByType(PaymentCard)).toBe(card);
  expect(card.props).toMatchObject({address, currency, holdings, state});
  expect(renderer!.root.findByType(CurrencyPicker).props.visible).toBe(true);
  const rendered = JSON.stringify(renderer!.toJSON());
  expect(rendered.indexOf('copy-wallet-address')).toBeLessThan(rendered.indexOf('mode-customer'));
  expect(rendered.indexOf('mode-customer')).toBeLessThan(rendered.indexOf('Lemon Stand'));

  await ReactTestRenderer.act(() => useAppStore.getState().setMode('customer'));
  expect(renderer!.root.findByType(PaymentCard)).toBe(card);
});

it('asks an existing merchant to complete missing email without losing the saved profile', async () => {
  const legacyProfile = {...merchantProfile};
  Reflect.deleteProperty(legacyProfile, 'email');
  const navigation = {navigate: jest.fn()};
  await ReactTestRenderer.act(() => {
    useAppStore.setState({merchantProfile: legacyProfile, mode: 'customer'});
    renderer = ReactTestRenderer.create(<HomeScreen navigation={navigation as never} route={{} as never} />);
  });
  await ReactTestRenderer.act(() => {
    renderer!.root.findByProps({testID: 'activate-merchant'}).props.onPress();
  });
  expect(navigation.navigate).toHaveBeenCalledWith('MerchantOnboarding');
  expect(useAppStore.getState().merchantProfile).toBe(legacyProfile);
  expect(renderer!.root.findAllByType(PaymentCard)).toHaveLength(1);
});

describe('offering to pay by holding the phones together', () => {
  async function renderHome() {
    await ReactTestRenderer.act(() => {
      useAppStore.setState({account: {name: 'Ege', createdAt: '2026-01-01T00:00:00.000Z'}, mode: 'customer'});
      renderer = ReactTestRenderer.create(
        <HomeScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />,
      );
    });
    return renderer!;
  }

  it('asks for Bluetooth once, where someone is already looking for how to pay', async () => {
    mockProximity.authorized = false;
    const home = await renderHome();

    const row = home.root.findByProps({testID: 'home-allow-proximity'});
    await ReactTestRenderer.act(() => row.props.onPress());
    expect(mockProximity.request).toHaveBeenCalledTimes(1);
  });

  it('is gone for good once Bluetooth has been granted', async () => {
    const home = await renderHome();
    expect(home.root.findAllByProps({testID: 'home-allow-proximity'})).toHaveLength(0);
  });

  it('says nothing about Bluetooth on a phone that has none', async () => {
    mockProximity.supported = false;
    mockProximity.authorized = false;
    const home = await renderHome();
    expect(home.root.findAllByProps({testID: 'home-allow-proximity'})).toHaveLength(0);
  });
});
