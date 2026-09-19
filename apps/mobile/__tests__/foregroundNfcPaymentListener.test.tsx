import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {ForegroundNfcPaymentListener} from '../src/features/payments/ForegroundNfcPaymentListener';
import {DEFAULT_INTENT_LIFETIME_LEDGERS, encodePaymentQr} from '@rosapay/protocol';
import {mockSignedIntent} from './fixtures/signedIntent';

const mockNfc = {active: false, handlers: undefined as undefined | {onRequest(value: string): void; onError(value: string): void}};

jest.mock('../src/features/payments/useNfc', () => ({
  useNfcReader: (active: boolean, handlers: typeof mockNfc.handlers) => {
    mockNfc.active = active;
    mockNfc.handlers = handlers;
  },
}));

jest.mock('../src/shared/i18n', () => ({useTranslate: () => (value: string) => value}));

describe('foreground NFC payment receiving', () => {
  beforeEach(() => {
    mockNfc.active = false;
    mockNfc.handlers = undefined;
  });

  it('routes a verified tap from the home app state to NFC confirmation', async () => {
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundNfcPaymentListener active latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    expect(mockNfc.active).toBe(true);
    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
    });
    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'nfc',
    });
  });

  it('does not navigate when a tap cannot be checked against a live ledger', async () => {
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundNfcPaymentListener active latestLedger={undefined} navigation={navigation} />,
      );
    });

    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('refreshes the live ledger before accepting a tap', async () => {
    const navigate = jest.fn();
    const refreshLedger = jest.fn().mockResolvedValue(1_500_001);
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundNfcPaymentListener
          active
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
    });

    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshLedger).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'nfc',
    });
  });

  it('does not use the cached ledger when the live refresh fails', async () => {
    const navigate = jest.fn();
    const refreshLedger = jest.fn().mockRejectedValue(new Error('offline'));
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundNfcPaymentListener
          active
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
    });

    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
    });

    expect(refreshLedger).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('accepts a tap read a few ledgers behind the merchant that minted it', async () => {
    // Neither phone shares a clock. The merchant mints `expiresAtLedger` from
    // its own RPC poll, and a receiver polling a different node can still be a
    // few ledgers behind when the tap lands. That request is honest, so the
    // reader's lifetime bound has to be looser than the minting bound.
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    const behind = mockSignedIntent.intent.expiresAtLedger - DEFAULT_INTENT_LIFETIME_LEDGERS - 5;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundNfcPaymentListener active latestLedger={behind} navigation={navigation} />,
      );
    });

    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
    });

    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'nfc',
    });
  });

  it('does not navigate when the listener becomes inactive during ledger refresh', async () => {
    const navigate = jest.fn();
    let resolveLedger!: (ledger: number) => void;
    const refreshLedger = jest.fn(() => new Promise<number>(resolve => { resolveLedger = resolve; }));
    const navigation = {navigate} as never;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ForegroundNfcPaymentListener
          active
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
    });

    const request = mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent)) as unknown as Promise<void>;
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundNfcPaymentListener
          active={false}
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
      resolveLedger(1_500_001);
    });
    await ReactTestRenderer.act(async () => {
      await request;
    });

    expect(navigate).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });
});
