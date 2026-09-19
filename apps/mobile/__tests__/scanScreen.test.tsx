/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {encodePaymentQr} from '@rosapay/protocol';
import {ScanScreen} from '../src/features/payments/ScanScreen';
import {useAppStore} from '../src/state/appStore';
import {mockSignedIntent} from './fixtures/signedIntent';

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

jest.mock('../src/features/payments/cameraPermission', () => ({
  requestCameraPermission: jest.fn().mockResolvedValue('granted'),
}));

jest.mock('../src/shared/useStellarHealth', () => ({
  useStellarHealth: () => ({data: {latestLedger: 1_500_000}}),
}));

// The balance reads the ledger through two hooks; the screen's job is what it
// does with their answers, so they are the seam rather than the network.
jest.mock('../src/shared/useWalletBalance', () => ({
  useWalletBalance: jest.fn().mockReturnValue({data: undefined, isPending: true, isError: false}),
}));

jest.mock('../src/shared/useBalanceValue', () => ({
  useBalanceValue: jest.fn().mockReturnValue({data: null}),
}));

jest.mock('../src/features/wallet/currentAccount', () => ({
  useCurrentAccount: jest.fn().mockReturnValue(null),
  needsTrustlines: jest.fn().mockReturnValue(false),
}));

// The native module is what differs between the platforms, so it is the seam:
// each test states what a real device would report and the screen follows.
jest.mock('../src/native/nativeNfc', () => ({
  nfcUnavailable: {supported: false, enabled: false, canBroadcast: false, needsUserAction: false},
  getNfcStatus: jest
    .fn()
    .mockResolvedValue({supported: false, enabled: false, canBroadcast: false, needsUserAction: false}),
  startNfcReader: jest.fn().mockReturnValue(jest.fn()),
  startNfcBroadcast: jest.fn().mockResolvedValue(undefined),
  stopNfcBroadcast: jest.fn().mockResolvedValue(undefined),
}));

type Navigation = {navigate: jest.Mock; addListener: jest.Mock};

const activeRenderers = new Set<ReactTestRenderer.ReactTestRenderer>();

function navigation(): Navigation {
  return {navigate: jest.fn(), addListener: jest.fn().mockReturnValue(jest.fn())};
}

async function renderScanner(nav: Navigation) {
  const Screen = ScanScreen as unknown as React.ComponentType<{navigation: Navigation}>;
  // The balance strip above the camera reads through react-query, so the screen
  // needs a client the way the app gives it one. Retries are off so a failing
  // balance read settles inside the test rather than backing off.
  const queryClient = new QueryClient({
    defaultOptions: {queries: {gcTime: 0, retry: false, staleTime: 0}},
  });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <Screen navigation={nav} />
      </QueryClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  activeRenderers.add(renderer);
  return renderer;
}

/** Drives the camera the way a real read does: one event per frame in view. */
async function read(renderer: ReactTestRenderer.ReactTestRenderer, value: string) {
  const camera = renderer.root.findByProps({testID: 'scan-camera'});
  await ReactTestRenderer.act(() => {
    camera.props.onReadCode({nativeEvent: {codeStringValue: value, codeFormat: 'qr'}});
  });
}

describe('the scanner', () => {
  it('opens the confirmation for a merchant-signed request the camera read', async () => {
    const nav = navigation();
    const renderer = await renderScanner(nav);

    await read(renderer, encodePaymentQr(mockSignedIntent));

    expect(nav.navigate).toHaveBeenCalledWith('Confirm', {payload: mockSignedIntent});
  });

  it('confirms once even though the camera keeps reading the same code', async () => {
    const nav = navigation();
    const renderer = await renderScanner(nav);
    const encoded = encodePaymentQr(mockSignedIntent);

    await read(renderer, encoded);
    await read(renderer, encoded);
    await read(renderer, encoded);

    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });

  it('stays on the scanner and explains anything that is not a payment request', async () => {
    const nav = navigation();
    const renderer = await renderScanner(nav);

    await read(renderer, 'https://example.com/menu');

    expect(nav.navigate).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('Unsupported payment QR');
  });

  it('recovers after a bad read, so the next code still pays', async () => {
    const nav = navigation();
    const renderer = await renderScanner(nav);

    await read(renderer, 'rosapay://pay/not-base64-json');
    expect(nav.navigate).not.toHaveBeenCalled();

    await read(renderer, encodePaymentQr(mockSignedIntent));
    expect(nav.navigate).toHaveBeenCalledWith('Confirm', {payload: mockSignedIntent});
  });
});

afterEach(() => {
  ReactTestRenderer.act(() => {
    activeRenderers.forEach(renderer => renderer.unmount());
  });
  activeRenderers.clear();
  useAppStore.setState({pendingRequest: null});
});

/**
 * iOS reads a tap but cannot listen for one in the background: the reader is a
 * system sheet that would cover the camera. So on iPhone the tap is a button,
 * and on Android it stays armed with no button at all.
 */
describe('the tap path across the two platforms', () => {
  const nfcStatus = jest.requireMock('../src/native/nativeNfc') as {
    getNfcStatus: jest.Mock;
    startNfcReader: jest.Mock;
  };

  // Each case states its own device, so calls must not carry over from the last.
  beforeEach(() => {
    jest.clearAllMocks();
    nfcStatus.startNfcReader.mockReturnValue(jest.fn());
  });

  it('asks an iPhone customer to open the reader, then reads the merchant tap', async () => {
    const stop = jest.fn();
    nfcStatus.getNfcStatus.mockResolvedValue({
      supported: true,
      enabled: true,
      canBroadcast: false,
      needsUserAction: true,
    });
    nfcStatus.startNfcReader.mockImplementation(() => stop);

    const nav = navigation();
    const renderer = await renderScanner(nav);

    // Nothing is listening until the customer says so.
    expect(nfcStatus.startNfcReader).not.toHaveBeenCalled();

    const tap = renderer.root.findByProps({testID: 'scan-start-tap'});
    await ReactTestRenderer.act(async () => {
      tap.props.onPress();
      await Promise.resolve();
    });

    expect(nfcStatus.startNfcReader).toHaveBeenCalledTimes(1);

    // The payload an Android merchant publishes is the same signed request the
    // QR carries, and it goes through the same verification.
    const handlers = nfcStatus.startNfcReader.mock.calls[0]![0];
    await ReactTestRenderer.act(async () => {
      handlers.onRequest(encodePaymentQr(mockSignedIntent));
      await Promise.resolve();
    });

    expect(nav.navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'nfc',
    });
  });

  it('arms itself on Android and shows no button', async () => {
    nfcStatus.getNfcStatus.mockResolvedValue({
      supported: true,
      enabled: true,
      canBroadcast: true,
      needsUserAction: false,
    });
    nfcStatus.startNfcReader.mockImplementation(() => jest.fn());

    const renderer = await renderScanner(navigation());

    expect(nfcStatus.startNfcReader).toHaveBeenCalled();
    expect(renderer.root.findAllByProps({testID: 'scan-start-tap'})).toHaveLength(0);
  });

  it('offers no tap at all on a phone without NFC', async () => {
    nfcStatus.getNfcStatus.mockResolvedValue({
      supported: false,
      enabled: false,
      canBroadcast: false,
      needsUserAction: false,
    });

    const renderer = await renderScanner(navigation());

    expect(nfcStatus.startNfcReader).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({testID: 'scan-start-tap'})).toHaveLength(0);
  });
});

/**
 * Someone aiming at a merchant's code is about to commit to an amount, so what
 * they can cover has to be on that screen rather than a tab away.
 */
describe('the balance above the camera', () => {
  const wallet = jest.requireMock('../src/shared/useWalletBalance') as {useWalletBalance: jest.Mock};
  const valuation = jest.requireMock('../src/shared/useBalanceValue') as {useBalanceValue: jest.Mock};
  const current = jest.requireMock('../src/features/wallet/currentAccount') as {
    useCurrentAccount: jest.Mock;
    needsTrustlines: jest.Mock;
  };

  beforeEach(() => {
    current.useCurrentAccount.mockReturnValue({address: 'GABC', custody: 'device'});
    wallet.useWalletBalance.mockReturnValue({
      data: [{code: 'XLM', amount: '37.3134329'}],
      isPending: false,
      isError: false,
    });
    valuation.useBalanceValue.mockReturnValue({data: null});
  });

  it('shows each holding and what the wallet is worth in lira', async () => {
    valuation.useBalanceValue.mockReturnValue({
      data: {amount: '500.00', currency: 'TRY', holdings: []},
    });

    const tree = JSON.stringify((await renderScanner(navigation())).toJSON());

    expect(tree).toContain('YOUR BALANCE');
    // Read, not signed: the balance is rounded for legibility here, unlike the
    // amount on the confirmation screen.
    expect(tree).toContain('37.31 XLM');
    expect(tree).toContain('₺500.00');
    // Marked as an estimate, because a SEP-38 indicative price is one.
    expect(tree).toContain('≈');
  });

  it('shows the holdings alone when nothing will quote a rate', async () => {
    valuation.useBalanceValue.mockReturnValue({data: null});

    const tree = JSON.stringify((await renderScanner(navigation())).toJSON());

    expect(tree).toContain('37.31 XLM');
    // A conversion this app invented would be worse than no conversion.
    expect(tree).not.toContain('₺');
    expect(tree).not.toContain('≈');
  });

  it('says the balance is unavailable rather than showing it as zero', async () => {
    wallet.useWalletBalance.mockReturnValue({data: undefined, isPending: false, isError: true});

    const tree = JSON.stringify((await renderScanner(navigation())).toJSON());

    expect(tree).toContain('Balance unavailable right now');
    // Telling someone holding lumens that they hold none is the failure worth
    // avoiding here.
    expect(tree).not.toContain('0 XLM');
  });

  it('shows no balance strip at all before there is a wallet', async () => {
    current.useCurrentAccount.mockReturnValue(null);

    const tree = JSON.stringify((await renderScanner(navigation())).toJSON());

    expect(tree).not.toContain('YOUR BALANCE');
  });
});

describe('what the scanner offers when there is nothing to scan', () => {
  it('offers no payment at all when this device has not made one', async () => {
    useAppStore.setState({pendingRequest: null});

    const renderer = await renderScanner(navigation());
    const tree = JSON.stringify(renderer.toJSON());

    // The screen used to fall back to an invented merchant behind a button
    // reading "Scan demo QR". Its recipient was the all-zeros address, so it
    // could never settle — it walked someone through a payment that was not one.
    expect(tree).not.toContain('demo');
    expect(tree).not.toContain('Demo');
    expect(renderer.root.findAllByProps({testID: 'scan-own-request'})).toHaveLength(0);
  });

  it('offers this device’s own request once merchant mode has made one', async () => {
    useAppStore.setState({pendingRequest: mockSignedIntent});

    const nav = navigation();
    const renderer = await renderScanner(nav);
    const button = renderer.root.findByProps({testID: 'scan-own-request'});
    await ReactTestRenderer.act(() => {
      button.props.onPress();
    });

    // The real signed request, so it settles on chain like any other.
    expect(nav.navigate).toHaveBeenCalledWith('Confirm', {payload: mockSignedIntent});
  });
});
