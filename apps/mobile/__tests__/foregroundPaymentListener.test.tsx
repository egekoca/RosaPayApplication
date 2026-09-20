import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  ForegroundPaymentListener,
  LEDGER_DEADLINE_MS,
  REOFFER_DELAY_MS,
} from '../src/features/payments/ForegroundPaymentListener';
import {DEFAULT_INTENT_LIFETIME_LEDGERS, encodePaymentQr} from '@rosapay/protocol';
import {mockSignedIntent} from './fixtures/signedIntent';

const mockProximity = {
  active: false,
  handlers: undefined as
    | undefined
    | {onRequest(request: {payload: string; touching: boolean}): void; onError(value: string): void},
};

jest.mock('../src/features/payments/useProximity', () => ({
  useProximityScanner: (active: boolean, handlers: typeof mockProximity.handlers) => {
    mockProximity.active = active;
    mockProximity.handlers = handlers;
    return {supported: true, enabled: true, authorized: true, canBroadcast: true};
  },
}));

jest.mock('../src/shared/i18n', () => ({useTranslate: () => (value: string) => value}));

const mockHold = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/native/nativeProximity', () => ({
  holdProximityPeer: (...args: unknown[]) => mockHold(...args),
}));

/** What a merchant held against this phone looks like arriving. */
const arrival = (touching = true) => ({payload: encodePaymentQr(mockSignedIntent), touching});

/** The same arrival, from a merchant still on the other end of the link. */
const arrivalOverCounter = () => ({...arrival(), peerId: 'merchant-1'});

describe('foreground payment receiving', () => {
  beforeEach(() => {
    mockProximity.active = false;
    mockProximity.handlers = undefined;
    mockHold.mockClear();
  });

  it('opens a request with no ledger at all when the merchant is still on the line', async () => {
    // The whole point of the transport: this phone is in airplane mode, so it
    // has no ledger and cannot get one. The merchant that sent the request is
    // the half with a connection, and it checks the expiry before it simulates.
    const navigate = jest.fn();
    const refreshLedger = jest.fn().mockResolvedValue(undefined);
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener
          active
          latestLedger={undefined}
          refreshLedger={refreshLedger}
          navigation={{navigate} as never}
        />,
      );
    });

    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest(arrivalOverCounter() as never);
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'ble',
      peerId: 'merchant-1',
    });
  });

  it('holds the merchant before leaving the screen that found it', async () => {
    // Navigating stops the scanner, and stopping the scanner used to drop every
    // link it had made — including the one the payment is about to happen over.
    const navigate = jest.fn();
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active latestLedger={1_500_000} navigation={{navigate} as never} />,
      );
    });

    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest(arrivalOverCounter() as never);
      await Promise.resolve();
    });

    expect(mockHold).toHaveBeenCalledWith('merchant-1');
    expect(mockHold.mock.invocationCallOrder[0]!).toBeLessThan(navigate.mock.invocationCallOrder[0]!);
  });

  it('does not wait out a network timeout when a merchant is already on the line', async () => {
    // A phone on a captive Wi-Fi has a route and no internet, so this read sits
    // for the system's own timeout. The request screen must not sit with it.
    jest.useFakeTimers();
    const navigate = jest.fn();
    const refreshLedger = jest.fn().mockReturnValue(new Promise(() => undefined));
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener
          active
          latestLedger={undefined}
          refreshLedger={refreshLedger}
          navigation={{navigate} as never}
        />,
      );
    });

    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest(arrivalOverCounter() as never);
      jest.advanceTimersByTime(LEDGER_DEADLINE_MS + 10);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledWith('Confirm', expect.objectContaining({peerId: 'merchant-1'}));
    jest.useRealTimers();
  });

  it('routes a verified request from the home app state to confirmation', async () => {
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    expect(mockProximity.active).toBe(true);
    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest(arrival());
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'ble',
    });
  });

  it('does not navigate when a request cannot be checked against a live ledger', async () => {
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active latestLedger={undefined} navigation={navigation} />,
      );
    });

    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest(arrival());
      await Promise.resolve();
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('refreshes the live ledger before accepting a request', async () => {
    const navigate = jest.fn();
    const refreshLedger = jest.fn().mockResolvedValue(1_500_001);
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener
          active
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
    });

    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest(arrival());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshLedger).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'ble',
    });
  });

  it('does not use the cached ledger when the live refresh fails', async () => {
    const navigate = jest.fn();
    const refreshLedger = jest.fn().mockRejectedValue(new Error('offline'));
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener
          active
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
    });

    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest(arrival());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshLedger).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('accepts a request read a few ledgers behind the merchant that minted it', async () => {
    // Neither phone shares a clock. The merchant mints `expiresAtLedger` from
    // its own RPC poll, and a receiver polling a different node can still be a
    // few ledgers behind when the request lands. That request is honest, so the
    // receiving lifetime bound has to be looser than the minting bound.
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    const behind = mockSignedIntent.intent.expiresAtLedger - DEFAULT_INTENT_LIFETIME_LEDGERS - 5;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active latestLedger={behind} navigation={navigation} />,
      );
    });

    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest(arrival());
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'ble',
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
        <ForegroundPaymentListener
          active
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
    });

    mockProximity.handlers!.onRequest(arrival());
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener
          active={false}
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
      resolveLedger(1_500_001);
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigate).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('stops scanning for a merchant when the listener is not armed', () => {
    const navigation = {navigate: jest.fn()} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active={false} latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    expect(mockProximity.active).toBe(false);
  });

  it('does not take the screen back when the customer is still at the counter', async () => {
    // Backing out of a request does not move anyone. The merchant keeps
    // advertising, and without this the screen would be seized again at once
    // and the only escape would be to walk away.
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ForegroundPaymentListener active latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    const arrive = async () => {
      await ReactTestRenderer.act(async () => {
        mockProximity.handlers!.onRequest(arrival());
        await Promise.resolve();
      });
    };

    await arrive();
    expect(navigate).toHaveBeenCalledTimes(1);

    // Leaving Confirm and coming back re-arms the listener, which is what makes
    // this reachable at all.
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active={false} latestLedger={1_500_000} navigation={navigation} />,
      );
    });
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    await arrive();
    expect(navigate).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('offers the same counter again once the customer has had time to walk away', async () => {
    // The point of the delay is to stop the screen being seized, not to refuse
    // a customer who changed their mind at the same till.
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ForegroundPaymentListener active latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    const arrive = async () => {
      await ReactTestRenderer.act(async () => {
        mockProximity.handlers!.onRequest(arrival());
        await Promise.resolve();
      });
    };

    await arrive();
    expect(navigate).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + REOFFER_DELAY_MS + 1);
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active={false} latestLedger={1_500_000} navigation={navigation} />,
      );
    });
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active latestLedger={1_500_000} navigation={navigation} />,
      );
    });
    await arrive();

    expect(navigate).toHaveBeenCalledTimes(2);
    now.mockRestore();
    ReactTestRenderer.act(() => renderer.unmount());
  });
});
