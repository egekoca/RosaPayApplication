import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {PaymentConfirmationScreen} from '../src/features/payments/PaymentConfirmationScreen';
import {mockSignedIntent} from './fixtures/signedIntent';

jest.mock('@react-navigation/native', () => ({useIsFocused: () => true}));

const mockMutate = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  // Runs the real mutation, because what is under test here is which payment
  // path the screen chooses. A stub that only records the press proves nothing
  // about that, and quietly passes any assertion about what was never called.
  useMutation: (options: {mutationFn(): Promise<unknown>; onSuccess?(value: unknown): void}) => ({
    mutate: () => {
      mockMutate();
      return options.mutationFn().then(
        value => options.onSuccess?.(value),
        () => undefined,
      );
    },
    isPending: false,
    isError: false,
    error: null,
  }),
  // Every network-backed read fails, which is what airplane mode looks like —
  // except the balance, which keeps the last reading it managed, the way React
  // Query does. That stale number is exactly what this screen has to be honest
  // about.
  useQuery: (options: {queryKey?: readonly unknown[]}) =>
    options?.queryKey?.[0] === 'wallet-balance'
      ? {data: mockHoldings, isPending: false, isError: true, dataUpdatedAt: 1, refetch: jest.fn()}
      : {data: undefined, isPending: false, isError: true, isSuccess: false, refetch: jest.fn()},
}));

let mockHoldings: Array<{code: string; amount: string}> | undefined;

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
  useStellarHealth: () => ({data: undefined, isError: true, isPending: false}),
}));
jest.mock('../src/features/wallet/currentAccount', () => ({
  useCurrentAccount: () => ({address: 'GABC'}),
}));
jest.mock('../src/shared/i18n', () => ({useTranslate: () => (value: string) => value}));
jest.mock('../src/state/appStore', () => {
  // Selector-aware, because the screen reads receipts through one: a payment
  // this phone has already made is what makes a stale balance honest.
  const state = {addReceipt: jest.fn(), receipts: []};
  return {useAppStore: (select?: (value: typeof state) => unknown) => (select ? select(state) : state)};
});

const mockRelease = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/native/nativeProximity', () => ({
  releaseProximityPeer: (...args: unknown[]) => mockRelease(...args),
}));
const mockOverCounter = jest.fn();
const mockSettle = jest.fn();
jest.mock('../src/features/payments/offlineCustomer', () => ({
  payOfflineOverCounter: (...args: unknown[]) => mockOverCounter(...args),
}));
jest.mock('../src/features/payments/settlementAdapter', () => ({
  settlePaymentIntent: (...args: unknown[]) => mockSettle(...args),
}));

function render(params: Record<string, unknown>) {
  const navigation = {isFocused: () => true, replace: jest.fn()};
  const props = {
    navigation,
    route: {key: 'confirm', name: 'Confirm', params: {payload: mockSignedIntent, ...params}},
  } as unknown as React.ComponentProps<typeof PaymentConfirmationScreen>;
  return ReactTestRenderer.create(<PaymentConfirmationScreen {...props} />);
}

describe('approving a payment on a phone with no network', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHoldings = [{code: 'XLM', amount: '50'}];
  });

  it('warns when what this phone last knew it held cannot cover the payment', () => {
    // Forty paid at the last counter leaves ten, and the card already knows it:
    // the receipt for that payment is subtracted from the stale reading. The
    // customer is told before the prompt rather than by a merchant's failure.
    mockHoldings = [{code: 'XLM', amount: '10'}];
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = render({transport: 'ble', peerId: 'merchant-1'});
    });

    expect(renderer.root.findByProps({testID: 'counter-shortfall'})).toBeTruthy();
    // Warned, never blocked: this reading may be old, and money can arrive from
    // anyone while this phone is offline. The merchant's simulation is the gate.
    expect(renderer.root.findByProps({testID: 'approve-payment'}).props.disabled).toBe(false);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('says nothing about a balance it has never managed to read', () => {
    mockHoldings = undefined;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = render({transport: 'ble', peerId: 'merchant-1'});
    });

    expect(renderer.root.findAllByProps({testID: 'counter-shortfall'})).toHaveLength(0);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('lets a customer approve when the merchant is on the other end of the link', () => {
    // Nothing this screen usually waits for can be read in airplane mode. None
    // of it is a check this screen performs: the merchant's simulation decides
    // whether the wallet can cover it, and the contract decides the expiry.
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = render({transport: 'ble', peerId: 'merchant-1'});
    });

    const approve = renderer.root.findByProps({testID: 'approve-payment'});
    expect(approve.props.disabled).toBe(false);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('still refuses a scanned request that nothing can verify', () => {
    // No merchant on the line means no second opinion about the expiry, so the
    // screen fails closed exactly as it always has.
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = render({transport: 'qr'});
    });

    expect(renderer.root.findByProps({testID: 'approve-payment'}).props.disabled).toBe(true);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('pays for itself when the counter has nothing to say', async () => {
    /*
     * Bluetooth used to mean only this phone's own settlement, and making it
     * mean only the counter was a straight loss: a customer with a working
     * connection could no longer pay a till whose half of the conversation was
     * not answering. Both paths exist, so the counter is tried and this one is
     * kept underneath it.
     */
    mockOverCounter.mockRejectedValue(new Error('That counter cannot take a payment offline'));
    mockSettle.mockResolvedValue({intentId: 'x'});
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = render({transport: 'ble', peerId: 'merchant-1'});
    });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'approve-payment'}).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockOverCounter).toHaveBeenCalled();
    expect(mockSettle).toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('does not pay twice once a signature has crossed', async () => {
    // Past that point the merchant may already have submitted it, and paying
    // again would ask the customer to approve what the chain is about to refuse
    // as already settled.
    mockOverCounter.mockImplementation(async ({onStage}: {onStage(s: string): void}) => {
      onStage('signing');
      throw new Error('The merchant did not say whether this payment went through');
    });
    mockSettle.mockResolvedValue({intentId: 'x'});
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = render({transport: 'ble', peerId: 'merchant-1'});
    });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'approve-payment'}).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSettle).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('lets the merchant go when the customer walks away from the screen', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = render({transport: 'ble', peerId: 'merchant-1'});
    });
    expect(mockRelease).not.toHaveBeenCalled();

    ReactTestRenderer.act(() => renderer.unmount());
    expect(mockRelease).toHaveBeenCalledWith('merchant-1');
  });
});
