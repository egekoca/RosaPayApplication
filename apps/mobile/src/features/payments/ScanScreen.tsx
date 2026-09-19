import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {CameraOff, Nfc, ScanLine} from 'lucide-react-native';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import {Camera, CameraType} from 'react-native-camera-kit';
import {Button, colors, radius, spacing, typography} from '@rosapay/ui';
import {encodePaymentQr} from '@rosapay/protocol';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {RosaMark} from '../../shared/RosaMark';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useWalletBalance} from '../../shared/useWalletBalance';
import {useBalanceValue} from '../../shared/useBalanceValue';
import {displayAmount} from '../../shared/displayAmount';
import {currencySymbol} from '../../shared/priceSource';
import {useCurrentAccount} from '../wallet/currentAccount';
import {useAppStore, type PaymentTransport} from '../../state/appStore';
import {requestCameraPermission} from './cameraPermission';
import {readPaymentQr} from './readPaymentQr';
import {useNfcReader} from './useNfc';
import {useTranslate} from '../../shared/i18n';

type Props = NativeStackScreenProps<RootStackParams, 'Scan'>;

type CameraState = 'checking' | 'granted' | 'denied' | 'unavailable';

export function ScanScreen({navigation}: Props) {
  const t = useTranslate();
  const pendingRequest = useAppStore(state => state.pendingRequest);
  const stellarHealth = useStellarHealth();
  const [error, setError] = useState<string | undefined>();
  const [camera, setCamera] = useState<CameraState>('checking');
  // A camera fires repeatedly while a code is in frame. Without this the screen
  // would push the confirmation route once per frame.
  const handled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // A simulator or emulator without a virtual camera resolves to 'unavailable',
    // and reading this device's own request keeps the customer path testable there.
    void requestCameraPermission().then(result => {
      if (!cancelled) setCamera(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Coming back from the confirmation screen must re-arm the scanner.
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        handled.current = false;
        setError(undefined);
      }),
    [navigation],
  );

  const scanContext = useCallback(
    () => ({
      network: 'testnet' as const,
      latestLedger: stellarHealth.data?.latestLedger ?? 0,
      maxLedgerLifetime: 1_440,
    }),
    [stellarHealth.data?.latestLedger],
  );

  const accept = useCallback(
    (value: string, transport: PaymentTransport = 'qr') => {
      if (handled.current) return;
      const result = readPaymentQr(value, scanContext());
      if (!result.ok) {
        setError(result.message);
        return;
      }
      handled.current = true;
      setError(undefined);
      navigation.navigate(
        'Confirm',
        transport === 'qr' ? {payload: result.payload} : {payload: result.payload, transport},
      );
    },
    [navigation, scanContext],
  );

  // A tap and a scan carry the same signed request, so both go through the same
  // verification before anything is confirmed.
  const nfc = useNfcReader(!handled.current, {
    onRequest: useCallback((payload: string) => accept(payload, 'nfc'), [accept]),
    onError: useCallback((message: string) => setError(message), []),
  });

  // One phone can play both sides on Testnet: make the request in merchant
  // mode, then read it back here. The request is the real signed one, so it
  // settles on chain like any other. There is deliberately no fallback when
  // none exists — an invented merchant is not something to hand anyone.
  const scanOwnRequest = () => {
    if (!pendingRequest) return;
    accept(encodePaymentQr(pendingRequest), 'qr');
  };

  return (
    <Screen contentStyle={styles.screen}>
      <ScanBalance />
      <View style={styles.camera}>
        {camera === 'granted' ? (
          <Camera
            style={StyleSheet.absoluteFill}
            cameraType={CameraType.Back}
            scanBarcode
            showFrame={false}
            scanThrottleDelay={600}
            onReadCode={event => accept(event.nativeEvent.codeStringValue)}
            onError={() => setCamera('unavailable')}
            testID="scan-camera"
          />
        ) : null}
        <View style={styles.scanFrame} pointerEvents="none">
          {camera === 'checking' ? <RosaMark motion="spin" showOrbit size={64} /> : null}
          {camera !== 'checking' && camera !== 'granted' ? <CameraOff color={colors.amber} size={52} /> : null}
          {camera === 'granted' ? <ScanLine color={colors.amber} size={52} /> : null}
        </View>
        <Text style={styles.cameraText} pointerEvents="none">
          {t(cameraMessage(camera, Boolean(pendingRequest)))}
        </Text>
      </View>

      {nfc.supported && nfc.enabled && !nfc.needsUserAction ? (
        <View style={styles.nfcRow}>
          <Nfc color={colors.amber} size={18} />
          <Text style={styles.nfcText}>{t("You can also hold this phone against the merchant's")}</Text>
        </View>
      ) : null}

      {/*
        iOS cannot listen for a tap in the background: the reader is a system
        sheet, so it opens on a deliberate press and covers the camera only
        while it is up.
      */}
      {nfc.startTap ? (
        <Button tone="secondary" onPress={nfc.startTap} testID="scan-start-tap">
          {t('Pay by tapping instead')}
        </Button>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {camera === 'denied' ? (
        <Button onPress={() => void Linking.openSettings()} testID="scan-open-settings">{t('Allow camera access')}</Button>
      ) : null}

      {pendingRequest ? (
        <Button
          tone={camera === 'unavailable' ? 'primary' : 'secondary'}
          onPress={scanOwnRequest}
          testID="scan-own-request">{t("Scan this device's request")}</Button>
      ) : null}
      <Text style={styles.fallback}>{t('QR is the universal payment path on iOS and Android.')}</Text>
    </Screen>
  );
}

function cameraMessage(state: CameraState, hasOwnRequest: boolean): string {
  switch (state) {
    case 'granted':
      return 'Align the merchant QR inside the frame';
    case 'checking':
      return 'Starting the camera';
    case 'denied':
      return 'Rosa Pay needs the camera to read a merchant QR';
    case 'unavailable':
      // Only point at the button when there is one. This used to promise a
      // request below whether or not one existed.
      return hasOwnRequest
        ? 'No camera on this device — use the request below'
        : 'No camera on this device. Make a request in Get paid to try a payment here.';
  }
}

/**
 * What the customer has, above the camera they are about to pay with.
 *
 * Someone pointing a phone at a merchant's code is about to commit to an
 * amount, and the one thing they need before that is whether they can cover it.
 * The holdings are the settled truth; the lira figure beside them is a SEP-38
 * indicative price, so it is shown as an approximation and disappears entirely
 * when nothing will quote — a made-up conversion on a payment screen is worse
 * than none.
 */
function ScanBalance() {
  const t = useTranslate();
  const account = useCurrentAccount();
  const balance = useWalletBalance();
  const value = useBalanceValue(balance.data);

  // Nothing to show before there is a wallet, and no skeleton either: the row
  // would appear, resize and settle while someone is trying to aim.
  if (!account) return null;

  const holdings = balance.data ?? [];

  return (
    <View style={styles.balance}>
      <Text style={styles.balanceLabel}>{t('YOUR BALANCE')}</Text>
      {balance.isPending ? (
        <Text style={styles.balanceMuted}>{t('Reading your balance…')}</Text>
      ) : balance.isError ? (
        <Text style={styles.balanceMuted}>{t('Balance unavailable right now')}</Text>
      ) : (
        <View style={styles.balanceRow}>
          <Text numberOfLines={1} style={styles.balanceAmount}>
            {holdings.map(holding => `${displayAmount(holding.amount)} ${holding.code}`).join('  ·  ')}
          </Text>
          {value.data ? (
            <Text style={styles.balanceValue}>
              {`≈ ${currencySymbol(value.data.currency)}${value.data.amount}`}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {justifyContent: 'center'},
  balance: {
    alignSelf: 'center',
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    maxWidth: 420,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    width: '100%',
  },
  balanceLabel: {...typography.overline, color: colors.inkMuted, fontSize: 9, letterSpacing: 1.4},
  balanceRow: {alignItems: 'baseline', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between'},
  balanceAmount: {...typography.title, color: colors.ink, flexShrink: 1, fontSize: 17},
  balanceValue: {...typography.label, color: colors.goldDeep, fontSize: 13},
  balanceMuted: {color: colors.inkMuted, fontSize: 13},
  camera: {alignItems: 'center', alignSelf: 'center', aspectRatio: 0.82, backgroundColor: colors.black, borderRadius: radius.md, justifyContent: 'center', gap: spacing.xl, maxWidth: 420, overflow: 'hidden', width: '100%'},
  scanFrame: {alignItems: 'center', borderColor: colors.lemon, borderRadius: radius.md, borderWidth: 2, height: 210, justifyContent: 'center', shadowColor: colors.lemon, shadowOpacity: 0.14, shadowRadius: 22, width: 210},
  cameraText: {...typography.label, color: colors.ink, maxWidth: 260, textAlign: 'center'},
  fallback: {fontSize: 13, lineHeight: 18, color: colors.inkMuted, textAlign: 'center'},
  error: {...typography.label, color: colors.danger, textAlign: 'center'},
  nfcRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  nfcText: {fontSize: 13, color: colors.inkMuted},
});
