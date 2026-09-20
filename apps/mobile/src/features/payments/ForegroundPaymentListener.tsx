import {useCallback, useEffect, useRef} from 'react';
import {Alert} from 'react-native';
import type {NavigationContainerRef} from '@react-navigation/native';
import {MAX_INTENT_ACCEPTANCE_LEDGERS} from '@rosapay/protocol';
import type {RootStackParams} from '../../app/navigation';
import type {ProximityRequest} from '../../native/nativeProximity';
import type {PaymentTransport} from '../../state/appStore';
import {useTranslate} from '../../shared/i18n';
import {readPaymentQr} from './readPaymentQr';
import {useProximityScanner} from './useProximity';

/**
 * How long a request that has already been shown stays un-reoffered by the radio.
 *
 * Long enough that declining one and putting the phone down is not undone by
 * the merchant still advertising, short enough that changing your mind at the
 * same counter does not mean waiting around.
 */
export const REOFFER_DELAY_MS = 30_000;

/**
 * Keeps this phone ready to be paid at, on whatever screen it is already on.
 *
 * Bluetooth is the whole transport. NFC used to sit beside it and was taken out
 * once it became clear it could never serve the pair this exists for: iOS grants
 * no third-party card emulation, so an iPhone merchant publishes nothing to tap
 * and an iPhone customer can only ever read a phone that is not an iPhone.
 * What it did instead was get in the way — a reader that had to be opened by
 * hand, on the screen where the request was about to arrive.
 *
 * Nothing here is trusted more than a camera is. The payload is the public,
 * merchant-signed request; the signature and the expiry are checked here, and
 * the customer still answers a device prompt before anything is spent.
 */
export function ForegroundPaymentListener({
  active,
  latestLedger,
  refreshLedger,
  navigation,
}: {
  /** Whether this screen is one the radio should be listening on. */
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
    // on `handled` would then ignore every later arrival until the route changed.
    const release = () => {
      handled.current = false;
    };
    Alert.alert(title, message, [{text: t('OK'), onPress: release}], {
      cancelable: true,
      onDismiss: release,
    });
  }, [t]);

  const accept = useCallback(async (payload: string, transport: PaymentTransport) => {
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
    // transition. Releasing the guard matters as much as returning: a request
    // dropped here without it would leave the radio deaf on the next screen.
    if (!activeRef.current || lifecycleRef.current !== lifecycle) {
      handled.current = false;
      return;
    }

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

    if (!activeRef.current || lifecycleRef.current !== lifecycle) {
      handled.current = false;
      return;
    }

    const {intentId} = result.payload.intent;
    // A customer who backs out of a request while still standing at the counter
    // is still in range of it. Without this the screen would be taken straight
    // back, over and over, and the only way out would be to walk away.
    const lastOffered = offered.current.get(intentId);
    if (lastOffered !== undefined && Date.now() - lastOffered < REOFFER_DELAY_MS) {
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
    navigation.navigate('Confirm', {payload: result.payload, transport});
  }, [latestLedger, navigation, refreshLedger, showError, t]);

  /*
   * Being near a counter opens the screen and stops there.
   *
   * A reading that said the phones were held together used to start the device
   * prompt by itself, on the reasoning that holding two phones together is
   * already a deliberate act. In the hand it is not: the request and Face ID
   * arrive in the same instant, over an amount nobody has read yet, and the
   * thing a customer is being asked to approve is behind the sheet asking
   * them. Approve is a button, and pressing it is what starts the prompt.
   */
  const onProximityRequest = useCallback(
    (request: ProximityRequest) => void accept(request.payload, 'ble'),
    [accept],
  );

  /**
   * A radio finding nothing is the normal state, not an error worth an alert.
   * A scanner that cannot start at all is worth one: anything quieter would
   * leave someone holding two phones together wondering why nothing happened.
   */
  const alerting = useRef(false);
  const onProximityError = useCallback((message: string) => {
    if (alerting.current) return;
    alerting.current = true;
    const release = () => {
      alerting.current = false;
    };
    Alert.alert(t('Payment request could not be verified'), t(message), [{text: t('OK'), onPress: release}], {
      cancelable: true,
      onDismiss: release,
    });
  }, [t]);

  useProximityScanner(active, {onRequest: onProximityRequest, onError: onProximityError});

  return null;
}
