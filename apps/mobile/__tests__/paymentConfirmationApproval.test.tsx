import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState} from 'react-native';
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

function renderConfirmation(transport: 'qr' | 'ble') {
  const navigation = {isFocused: () => true, replace: jest.fn()};
  const props = {
    navigation,
    route: {key: 'confirm', name: 'Confirm', params: {payload: mockSignedIntent, transport}},
  } as unknown as React.ComponentProps<typeof PaymentConfirmationScreen>;
  return ReactTestRenderer.create(<PaymentConfirmationScreen {...props} />);
}

/** Long enough that any timer which meant to fire would have. */
const LONG_ENOUGH_MS = 5_000;

describe('what it takes to start a payment', () => {
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

  /*
   * A request that arrived over Bluetooth used to raise the device prompt by
   * itself, on the reasoning that holding two phones together already said what
   * the customer meant. In the hand it does not: the screen and Face ID arrive
   * in the same instant, over an amount nobody has read yet, with the thing
   * being approved hidden behind the sheet asking about it.
   */
  it('raises no prompt for a Bluetooth request, however it arrived', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderConfirmation('ble');
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(LONG_ENOUGH_MS));
    expect(mockMutate).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('raises no prompt for a scan either', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderConfirmation('qr');
    });

    ReactTestRenderer.act(() => jest.advanceTimersByTime(LONG_ENOUGH_MS));
    expect(mockMutate).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('starts the payment when Approve is pressed, and only then', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = renderConfirmation('ble');
    });
    expect(mockMutate).not.toHaveBeenCalled();

    ReactTestRenderer.act(() => {
      renderer.root.findByProps({testID: 'approve-payment'}).props.onPress();
    });

    expect(mockMutate).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });
});
