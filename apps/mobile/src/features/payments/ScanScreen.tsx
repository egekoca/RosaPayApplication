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
import {AssetMark} from '../home/AssetMark';
import {useAppStore, type PaymentTransport} from '../../state/appStore';
import {requestCameraPermission, type CameraPermission} from './cameraPermission';
import {readPaymentQr} from './readPaymentQr';
import {useNfcReader} from './useNfc';
import {useTranslate} from '../../shared/i18n';

type Props = NativeStackScreenProps<RootStackParams, 'Scan'>;

type CameraState = 'checking' | 'granted' | 'denied' | 'unavailable' | 'error';

export function ScanScreen({navigation}: Props) {
  const t = useTranslate();
  const pendingRequest = useAppStore(state => state.pendingRequest);
  const stellarHealth = useStellarHealth();
  const [error, setError] = useState<string | undefined>();
  const [camera, setCamera] = useState<CameraState>('checking');
  // A camera fires repeatedly while a code is in frame. Without this the screen
  // would push the confirmation route once per frame.
  const handled = useRef(false);
  const cameraPermissionRequest = useRef<Promise<CameraPermission> | null>(null);

  const refreshCamera = useCallback(() => {
    const request = cameraPermissionRequest.current ?? requestCameraPermission();
    cameraPermissionRequest.current = request;
    void request.then(setCamera).finally(() => {
      if (cameraPermissionRequest.current === request) cameraPermissionRequest.current = null;
    });
  }, []);

  useEffect(() => {
    // A simulator or emulator without a virtual camera resolves to 'unavailable',
    // and reading this device's own request keeps the customer path testable there.
    refreshCamera();
  }, [refreshCamera]);

  // Coming back from the confirmation screen must re-arm the scanner.
  useEffect(() => {
    return navigation.addListener('focus', () => {
      handled.current = false;
      setError(undefined);
      // Permission may have been granted in Settings while this screen was
      // away. Refresh it when returning instead of keeping the old error.
      refreshCamera();
    });
  }, [navigation, refreshCamera]);

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
      {/*
        The camera takes the room left over and sits in the middle of it, so the
        balance stays pinned at the top as a header rather than being pushed
        into the centre of the screen along with everything else.
      */}
      <View style={styles.viewfinder}>
      <View style={styles.camera}>
        {camera === 'granted' ? (
          <Camera
            style={StyleSheet.absoluteFill}
            cameraType={CameraType.Back}
            scanBarcode
            showFrame={false}
            scanThrottleDelay={600}
            onReadCode={event => accept(event.nativeEvent.codeStringValue)}
            onError={() => setCamera('error')}
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
      ) : camera === 'error' ? (
        <Button onPress={refreshCamera} testID="scan-retry-camera">{t('Retry camera')}</Button>
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
    case 'error':
      return 'The camera could not start. Check camera access and try again.';
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
      {/*
        The name sits above the money rather than in a navigation bar, because
        this screen is a camera: it fills itself with whatever it is pointed at,
        and without the mark there is nothing on it saying which app is about to
        take a payment.
      */}
      <View style={styles.balanceHeader}>
        <RosaMark size={22} />
        <Text style={styles.balanceBrand}>{t('ROSA PAY')}</Text>
        <View style={styles.balanceSpacer} />
        {/*
          A total earns its place only when there is something to total. With
          one holding it repeats the figure on the row below it verbatim, which
          reads as though the screen is unsure.
        */}
        {value.data && holdings.length > 1 ? (
          <Text style={styles.balanceTotal}>
            {`≈ ${currencySymbol(value.data.currency)}${value.data.amount}`}
          </Text>
        ) : (
          <Text style={styles.balanceLabel}>{t('YOUR BALANCE')}</Text>
        )}
      </View>

      {balance.isPending ? (
        <Text style={styles.balanceMuted}>{t('Reading your balance…')}</Text>
      ) : balance.isError ? (
        <Text style={styles.balanceMuted}>{t('Balance unavailable right now')}</Text>
      ) : (
        holdings.map(holding => {
          // The per-asset lira figure, when the rate covered that asset. A
          // wallet holding two things is worth two separate amounts, and one
          // total answers a different question than "how much USDC do I have".
          const valued = value.data?.holdings.find(entry => entry.code === holding.code);
          return (
            <View key={holding.code} style={styles.balanceRow}>
              {/* Each asset's own mark, so it is recognised before it is read. */}
              <AssetMark code={holding.code} size={26} />
              <Text numberOfLines={1} style={styles.balanceAmount}>
                {`${displayAmount(holding.amount)} ${holding.code}`}
              </Text>
              <View style={styles.balanceSpacer} />
              {valued ? (
                <Text style={styles.balanceValue}>
                  {`≈ ${currencySymbol(value.data!.currency)}${valued.value}`}
                </Text>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Top-aligned, not centred: the balance is a header and belongs against the
  // top of the screen. The viewfinder below it absorbs the slack.
  screen: {gap: spacing.md, justifyContent: 'flex-start', paddingTop: spacing.xs},
  viewfinder: {alignItems: 'center', flexGrow: 1, gap: spacing.xl, justifyContent: 'center'},
  balance: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    maxWidth: 420,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    width: '100%',
  },
  balanceHeader: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  balanceBrand: {...typography.overline, color: colors.gold, fontSize: 10, letterSpacing: 1.6},
  balanceSpacer: {flex: 1},
  balanceTotal: {...typography.label, color: colors.ink, fontSize: 14},
  balanceLabel: {...typography.overline, color: colors.inkMuted, fontSize: 9, letterSpacing: 1.4},
  balanceRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 38},
  balanceAmount: {...typography.title, color: colors.ink, flexShrink: 1, fontSize: 17},
  balanceValue: {...typography.label, color: colors.goldDeep, fontSize: 13},
  balanceMuted: {color: colors.inkMuted, fontSize: 13, paddingVertical: spacing.sm},
  camera: {alignItems: 'center', alignSelf: 'center', aspectRatio: 0.82, backgroundColor: colors.black, borderRadius: radius.md, justifyContent: 'center', gap: spacing.xl, maxWidth: 420, overflow: 'hidden', width: '100%'},
  scanFrame: {alignItems: 'center', borderColor: colors.lemon, borderRadius: radius.md, borderWidth: 2, height: 210, justifyContent: 'center', shadowColor: colors.lemon, shadowOpacity: 0.14, shadowRadius: 22, width: 210},
  cameraText: {...typography.label, color: colors.ink, maxWidth: 260, textAlign: 'center'},
  fallback: {fontSize: 13, lineHeight: 18, color: colors.inkMuted, textAlign: 'center'},
  error: {...typography.label, color: colors.danger, textAlign: 'center'},
  nfcRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  nfcText: {fontSize: 13, color: colors.inkMuted},
});
