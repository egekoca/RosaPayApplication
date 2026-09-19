import {useCallback, useEffect, useRef} from 'react';
import {Alert} from 'react-native';
import type {NavigationContainerRef} from '@react-navigation/native';
import {MAX_INTENT_ACCEPTANCE_LEDGERS} from '@rosapay/protocol';
import type {RootStackParams} from '../../app/navigation';
import {useTranslate} from '../../shared/i18n';
import {readPaymentQr} from './readPaymentQr';
import {useNfcReader} from './useNfc';

export function ForegroundNfcPaymentListener({
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

  const onRequest = useCallback(async (payload: string) => {
    if (!activeRef.current || handled.current) return;
    handled.current = true;
    const lifecycle = lifecycleRef.current;

    let ledger = latestLedger;
    // Cached health data can be several ledgers old after the app returns from
    // the background. Refresh on every tap when the caller can do so; expiry is
    // security-sensitive and must be checked against a live ledger observation.
    if (refreshLedger) {
      try {
        ledger = await refreshLedger();
      } catch {
        ledger = undefined;
      }
    }

    // The ledger call can outlive the screen that accepted the tap. Do not
    // navigate from a stale NFC callback after a route change, lock, or
    // background transition.
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
    navigation.navigate('Confirm', {payload: result.payload, transport: 'nfc'});
  }, [latestLedger, navigation, refreshLedger, showError, t]);

  const onError = useCallback((message: string) => {
    if (handled.current) return;
    handled.current = true;
    showError(t('NFC reading failed'), t(message));
  }, [showError, t]);

  useNfcReader(active, {onRequest, onError});
  return null;
}
