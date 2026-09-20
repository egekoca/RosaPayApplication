import {useCallback, useEffect, useRef} from 'react';
import {Alert} from 'react-native';
import type {NavigationContainerRef} from '@react-navigation/native';
import {MAX_INTENT_ACCEPTANCE_LEDGERS} from '@rosapay/protocol';
import type {RootStackParams} from '../../app/navigation';
import type {ProximityRequest} from '../../native/nativeProximity';
import type {PaymentTransport} from '../../state/appStore';
import {useTranslate} from '../../shared/i18n';
import {useNfcTapControl} from './nfcTapControl';
import {readPaymentQr} from './readPaymentQr';
import {useNfcReader} from './useNfc';
import {useProximityScanner} from './useProximity';

/**
 * How long a request that has already been shown stays un-reoffered by a radio.
 *
 * Long enough that declining one and putting the phone down is not undone by
 * the merchant still advertising, short enough that changing your mind at the
 * same counter does not mean waiting around.
 */
export const REOFFER_DELAY_MS = 30_000;

/**
 * Keeps this phone ready to be paid at, on whatever screen it is already on.
 *
 * Two radios feed it. NFC is the better experience and stays the default where
 * both phones are Android. Bluetooth exists because iOS gives no third-party
 * app card emulation, so an iPhone merchant can never be tapped — without it,
 * two iPhones could only ever exchange a QR code. Both carry the identical
 * signed request, and both are checked identically before anything is offered.
 */
export function ForegroundPaymentListener({
  active,
  latestLedger,
  refreshLedger,
  navigation,
}: {
  active: boolean;
  latestLedger: number | undefined;
  refreshLedger?: () => Promise<number | undefined>;
  navigation: Pick<NavigationContainerRef<RootStackParams>, 'navigate'>;
}) {
  const t = useTranslate();
  const handled = useRef(false);
  const activeRef = useRef(active);
  const lifecycleRef = useRef(0);
  // When each request was last put on screen, so a radio that keeps shouting
  // cannot keep taking the screen back.
  const offered = useRef(new Map<string, number>());
  activeRef.current = active;

  useEffect(() => {
    lifecycleRef.current += 1;
    activeRef.current = active;
    if (active) handled.current = false;
  }, [active]);

  const showError = useCallback((title: string, message: string) => {
    // The guard has to be released however the alert goes away. On Android the
    // back button dismisses it without running `onPress`, and a listener latched
    // on `handled` would then ignore every later tap until the route changed.
    const release = () => {
      handled.current = false;
    };
    Alert.alert(title, message, [{text: t('OK'), onPress: release}], {
      cancelable: true,
      onDismiss: release,
    });
  }, [t]);

  /**
   * One path for both radios. An Android merchant publishes over NFC and
   * Bluetooth at once, so the same request often arrives twice; `handled` means
   * whichever gets there first is the one that counts.
   */
  const accept = useCallback(async (
    payload: string,
    transport: PaymentTransport,
    // Whether the arrival itself said what the customer meant, which is what
    // lets the confirmation screen raise the device prompt without a button.
    automatic: boolean,
  ) => {
    if (!activeRef.current || handled.current) return;
    handled.current = true;
    const lifecycle = lifecycleRef.current;

    let ledger = latestLedger;
    // Cached health data can be several ledgers old after the app returns from
    // the background. Refresh on every arrival when the caller can do so;
    // expiry is security-sensitive and must be checked against a live ledger.
    if (refreshLedger) {
      try {
        ledger = await refreshLedger();
      } catch {
        ledger = undefined;
      }
    }

    // The ledger call can outlive the screen that accepted the request. Do not
    // navigate from a stale callback after a route change, lock, or background
    // transition.
    if (!activeRef.current || lifecycleRef.current !== lifecycle) return;

    if (ledger === undefined) {
      showError(t('Payment request could not be verified'), t('Testnet unavailable, so an expiry cannot be set'));
      return;
    }

    const result = readPaymentQr(payload, {
      network: 'testnet',
      latestLedger: ledger,
      maxLedgerLifetime: MAX_INTENT_ACCEPTANCE_LEDGERS,
    });
    if (!result.ok) {
      showError(t('Payment request could not be verified'), t(result.message));
      return;
    }

    if (!activeRef.current || lifecycleRef.current !== lifecycle) return;

    const {intentId} = result.payload.intent;
    // A customer who backs out of a request while still standing at the counter
    // is still in range of it. Without this the screen would be taken straight
    // back, over and over, and the only way out would be to walk away. A tap is
    // exempt: reaching out and touching the phone again says "yes, again" in a
    // way a radio still shouting across a metre never does.
    const lastOffered = offered.current.get(intentId);
    if (transport !== 'nfc' && lastOffered !== undefined && Date.now() - lastOffered < REOFFER_DELAY_MS) {
      handled.current = false;
      return;
    }
    const now = Date.now();
    // Forget what has aged out, so a long day at a counter does not accumulate
    // every request the phone was ever near.
    for (const [seen, at] of offered.current) {
      if (now - at >= REOFFER_DELAY_MS) offered.current.delete(seen);
    }
    offered.current.set(intentId, now);
    navigation.navigate('Confirm', {payload: result.payload, transport, automatic});
  }, [latestLedger, navigation, refreshLedger, showError, t]);

  // A tap is a few centimetres or nothing, so it is always deliberate.
  const onNfcRequest = useCallback((payload: string) => void accept(payload, 'nfc', true), [accept]);
  // A radio reaches across a room. Only a signal that said the phones were
  // being held together stands in for a tap; anything weaker opens the screen
  // and waits for the customer to press Approve.
  const onProximityRequest = useCallback(
    (request: ProximityRequest) => void accept(request.payload, 'ble', request.touching),
    [accept],
  );

  const onError = useCallback((message: string) => {
    if (handled.current) return;
    handled.current = true;
    showError(t('NFC reading failed'), t(message));
  }, [showError, t]);

  /**
   * A radio finding nothing is the normal state, not an error worth an alert.
   * A scanner that cannot start at all is reported the same way a tap failure
   * is; anything quieter than that would leave someone holding two phones
   * together wondering why nothing happened.
   */
  const onProximityError = useCallback((message: string) => {
    if (handled.current) return;
    handled.current = true;
    showError(t('Payment request could not be verified'), t(message));
  }, [showError, t]);

  const reader = useNfcReader(active, {onRequest: onNfcRequest, onError});
  useProximityScanner(active, {onRequest: onProximityRequest, onError: onProximityError});

  // iOS hands back an opener because a Core NFC session is a system sheet that
  // cannot be armed silently. Publish it so the home screen can offer tapping
  // from the screen the customer is already on, instead of making them walk
  // into the scanner to find it. Android never sets one: it is already
  // listening, and a button would imply it was not.
  const setStartTap = useNfcTapControl(state => state.setStartTap);
  const startTap = active ? reader.startTap : undefined;
  useEffect(() => {
    setStartTap(startTap);
    return () => setStartTap(undefined);
  }, [setStartTap, startTap]);

  return null;
}
