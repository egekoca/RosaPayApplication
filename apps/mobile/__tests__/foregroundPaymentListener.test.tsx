import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {ForegroundPaymentListener, REOFFER_DELAY_MS} from '../src/features/payments/ForegroundPaymentListener';
import {DEFAULT_INTENT_LIFETIME_LEDGERS, encodePaymentQr} from '@rosapay/protocol';
import {mockSignedIntent} from './fixtures/signedIntent';
import {useNfcTapControl} from '../src/features/payments/nfcTapControl';

const mockNfc = {
  active: false,
  handlers: undefined as undefined | {onRequest(value: string): void; onError(value: string): void},
  // What `useNfcReader` hands back on a platform whose reader must be opened by
  // hand. Undefined on Android, where it is already listening.
  startTap: undefined as undefined | (() => void),
};

jest.mock('../src/features/payments/useNfc', () => ({
  useNfcReader: (active: boolean, handlers: typeof mockNfc.handlers) => {
    mockNfc.active = active;
    mockNfc.handlers = handlers;
    return {
      supported: true,
      enabled: true,
      canBroadcast: false,
      needsUserAction: mockNfc.startTap !== undefined,
      ...(mockNfc.startTap ? {startTap: mockNfc.startTap} : {}),
    };
  },
}));

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

describe('foreground payment receiving', () => {
  beforeEach(() => {
    mockNfc.active = false;
    mockNfc.handlers = undefined;
    mockProximity.active = false;
    mockProximity.handlers = undefined;
    mockNfc.startTap = undefined;
    useNfcTapControl.getState().setStartTap(undefined);
  });

  it('routes a verified tap from the home app state to NFC confirmation', async () => {
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    expect(mockNfc.active).toBe(true);
    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
    });
    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'nfc',
      automatic: true,
    });
  });

  it('does not navigate when a tap cannot be checked against a live ledger', async () => {
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active proximityActive latestLedger={undefined} navigation={navigation} />,
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
        <ForegroundPaymentListener
          active
          proximityActive
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
      automatic: true,
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
          proximityActive
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
        <ForegroundPaymentListener active proximityActive latestLedger={behind} navigation={navigation} />,
      );
    });

    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
    });

    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'nfc',
      automatic: true,
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
          proximityActive
          latestLedger={1_500_000}
          refreshLedger={refreshLedger}
          navigation={navigation}
        />,
      );
    });

    const request = mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent)) as unknown as Promise<void>;
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener
          active={false}
          proximityActive={false}
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

  it('offers the tap opener to the screens while a hand-opened reader is armed', () => {
    // iOS cannot poll silently, so the customer has to start the session. The
    // opener is published out of the listener because the home screen is the
    // place a customer would look for it, and it must disappear the moment the
    // listener stops so no screen can open a reader nothing is watching.
    const startTap = jest.fn();
    mockNfc.startTap = startTap;
    const navigation = {navigate: jest.fn()} as never;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    expect(useNfcTapControl.getState().startTap).toBe(startTap);

    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active={false} proximityActive={false} latestLedger={1_500_000} navigation={navigation} />,
      );
    });
    expect(useNfcTapControl.getState().startTap).toBeUndefined();

    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('never offers an opener on a platform that is already listening', () => {
    const navigation = {navigate: jest.fn()} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    expect(useNfcTapControl.getState().startTap).toBeUndefined();
  });

  it('accepts the same request over Bluetooth, for two phones that cannot tap', () => {
    // The whole reason this transport exists: iOS grants no third-party card
    // emulation, so an iPhone merchant publishes nothing to tap and a pair of
    // iPhones would otherwise be stuck with the camera.
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    expect(mockProximity.active).toBe(true);
    ReactTestRenderer.act(() => {
      void mockProximity.handlers!.onRequest({payload: encodePaymentQr(mockSignedIntent), touching: true});
    });

    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'ble',
      automatic: true,
    });
  });

  it('pays once when an Android merchant arrives over both radios at the same counter', async () => {
    // A merchant publishes over NFC and Bluetooth together, so the customer
    // hears the same request twice. Whichever lands first is the payment.
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    const encoded = encodePaymentQr(mockSignedIntent);
    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encoded);
      mockProximity.handlers!.onRequest({payload: encoded, touching: true});
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Confirm', {
      payload: mockSignedIntent,
      transport: 'nfc',
      automatic: true,
    });
  });

  it('stops scanning for a merchant when the listener is not armed', () => {
    const navigation = {navigate: jest.fn()} as never;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ForegroundPaymentListener active={false} proximityActive={false} latestLedger={1_500_000} navigation={navigation} />,
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
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    const arrive = async () => {
      await ReactTestRenderer.act(async () => {
        mockProximity.handlers!.onRequest({payload: encodePaymentQr(mockSignedIntent), touching: true});
      });
    };

    await arrive();
    expect(navigate).toHaveBeenCalledTimes(1);

    // Leaving Confirm and coming back re-arms the listener, which is what makes
    // this reachable at all.
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active={false} proximityActive={false} latestLedger={1_500_000} navigation={navigation} />,
      );
    });
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    await arrive();
    expect(navigate).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('always honours a tap, because reaching out and touching says it again', async () => {
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });

    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
    });
    // Two acts, because leaving a screen and coming back are two commits and
    // the guard is released by the effect that runs between them.
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active={false} proximityActive={false} latestLedger={1_500_000} navigation={navigation} />,
      );
    });
    ReactTestRenderer.act(() => {
      renderer.update(
        <ForegroundPaymentListener active proximityActive latestLedger={1_500_000} navigation={navigation} />,
      );
    });
    await ReactTestRenderer.act(async () => {
      await mockNfc.handlers!.onRequest(encodePaymentQr(mockSignedIntent));
    });

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(REOFFER_DELAY_MS).toBeGreaterThan(0);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('still hears Bluetooth after a tap that found nothing', async () => {
    /*
     * The whole iPhone-to-iPhone story. iOS grants no card emulation, so an
     * iPhone merchant publishes nothing to tap and the reader always fails —
     * at exactly the moment the phones are being held together. Both errors
     * used to raise the same flag `accept` reads, so that failure made the
     * Bluetooth scanner deaf until its alert was dismissed: the customer was
     * told tapping failed and never learned the request had been on the air.
     */
    const navigate = jest.fn();
    const navigation = {navigate} as never;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ForegroundPaymentListener
          active
          proximityActive
          latestLedger={1_500_000}
          navigation={navigation}
        />,
      );
    });

    ReactTestRenderer.act(() => {
      mockNfc.handlers!.onError('No tag found');
    });

    await ReactTestRenderer.act(async () => {
      mockProximity.handlers!.onRequest({payload: encodePaymentQr(mockSignedIntent), touching: true});
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledWith('Confirm', expect.objectContaining({transport: 'ble'}));
    ReactTestRenderer.act(() => renderer.unmount());
  });
});
