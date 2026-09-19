import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState} from 'react-native';
import {AUTOMATIC_AUTHORIZATION_DELAY_MS} from '../src/features/payments/useAutomaticAuthorization';
import {PaymentConfirmationScreen} from '../src/features/payments/PaymentConfirmationScreen';
import {mockSignedIntent} from './fixtures/signedIntent';

jest.mock('@react-navigation/native', () => ({useIsFocused: () => true}));

const mockMutate = jest.fn();
let mockFunding: Record<string, unknown>;

jest.mock('@tanstack/react-query', () => ({
  useMutation: () => ({mutate: mockMutate, isPending: false, isError: false, error: null}),
  useQuery: () => mockFunding,
}));

jest.mock('@rosapay/stellar', () => ({
  createStellarConfig: () => ({networkPassphrase: 'testnet'}),
  testnetDeployment: {swap: {routerContractId: 'CROUTER'}},
}));

jest.mock('@rosapay/ui', () => {
  const ReactModule = require('react');
  const Native = require('react-native');
  const scalar = new Proxy({}, {get: () => 8});
  const textStyle = new Proxy({}, {get: () => ({})});
  return {
    AnimatedContent: ({children}: {children: React.ReactNode}) => ReactModule.createElement(Native.View, null, children),
    Button: ({children, onPress, ...props}: Record<string, unknown>) =>
      ReactModule.createElement(Native.Pressable, {...props, onPress}, ReactModule.createElement(Native.Text, null, children)),
    Pulse: ({children}: {children: React.ReactNode}) => ReactModule.createElement(Native.View, null, children),
    SplitText: ({text}: {text: string}) => ReactModule.createElement(Native.Text, null, text),
    StatusPill: ({children}: {children: React.ReactNode}) => ReactModule.createElement(Native.Text, null, children),
    Stepper: () => ReactModule.createElement(Native.View),
    SurfaceCard: ({children}: {children: React.ReactNode}) => ReactModule.createElement(Native.View, null, children),
    colors: new Proxy({}, {get: () => '#111111'}),
    radius: scalar,
    spacing: scalar,
    typography: textStyle,
  };
});

jest.mock('../src/shared/Screen', () => {
  const Native = require('react-native');
  return {Screen: ({children}: {children: React.ReactNode}) => <Native.View>{children}</Native.View>};
});

jest.mock('../src/shared/RosaMark', () => ({RosaLoadingOverlay: () => null}));
jest.mock('../src/shared/useStellarHealth', () => ({
  useStellarHealth: () => ({data: {latestLedger: 1_500_000}, isError: false}),
}));
jest.mock('../src/features/wallet/currentAccount', () => ({
  useCurrentAccount: () => ({address: 'GABC'}),
}));
jest.mock('../src/shared/i18n', () => ({useTranslate: () => (value: string) => value}));
jest.mock('../src/state/appStore', () => ({useAppStore: () => ({addReceipt: jest.fn()})}));

const directFunding = {
  data: {
    options: [{kind: 'direct', asset: {code: 'XLM'}, spend: '2', held: '10'}],
    recommended: {kind: 'direct', asset: {code: 'XLM'}, spend: '2', held: '10'},
  },
  isPending: false,
  isError: false,
  isSuccess: true,
  refetch: jest.fn(),
};

function renderConfirmation(transport: 'nfc' | 'qr' | 'ble', automatic = transport === 'nfc') {
  const navigation = {isFocused: () => true, replace: jest.fn()};
  const props = {
    navigation,
    route: {key: 'confirm', name: 'Confirm', params: {payload: mockSignedIntent, transport, automatic}},
  } as unknown as React.ComponentProps<typeof PaymentConfirmationScreen>;
  return ReactTestRenderer.create(<PaymentConfirmationScreen {...props} />);
}

describe('confirming a payment that arrived by itself', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
    mockFunding = directFunding;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('starts the settlement mutation after a valid NFC request is ready', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderConfirmation('nfc');
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(AUTOMATIC_AUTHORIZATION_DELAY_MS));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('keeps QR on its explicit approval path', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderConfirmation('qr');
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(AUTOMATIC_AUTHORIZATION_DELAY_MS));
    expect(mockMutate).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('does not auto-authorize if funding cannot be checked', () => {
    mockFunding = {data: undefined, isPending: false, isError: true, isSuccess: false, refetch: jest.fn()};
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderConfirmation('nfc');
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(AUTOMATIC_AUTHORIZATION_DELAY_MS));
    expect(mockMutate).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('raises the prompt for a Bluetooth request read with the phones together', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderConfirmation('ble', true);
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(AUTOMATIC_AUTHORIZATION_DELAY_MS));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('waits for Approve when Bluetooth only saw a merchant in the room', () => {
    // The radio reaches further than a tap ever could. A merchant at the next
    // table is a request worth showing and never a payment worth starting.
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderConfirmation('ble', false);
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(AUTOMATIC_AUTHORIZATION_DELAY_MS));
    expect(mockMutate).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });
});
