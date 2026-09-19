import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ScanLine} from 'lucide-react-native';
import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, colors, radius, spacing, typography} from '@rosapay/ui';
import {decodePaymentQr, encodePaymentQr, validatePaymentIntent} from '@rosapay/protocol';
import {verifyMerchantSignature} from '@rosapay/stellar/merchant-signature';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useAppStore} from '../../state/appStore';
import {mockSignedIntent} from './mockIntent';

type Props = NativeStackScreenProps<RootStackParams, 'Scan'>;

export function ScanScreen({navigation}: Props) {
  const pendingRequest = useAppStore(state => state.pendingRequest);
  const stellarHealth = useStellarHealth();
  const [error, setError] = useState<string | undefined>();

  // Until the camera is wired, the scanner reads the request this device created,
  // falling back to the bundled fixture so the customer path is always testable.
  const scanDemo = () => {
    setError(undefined);
    const source = pendingRequest ?? mockSignedIntent;
    try {
      const payload = decodePaymentQr(encodePaymentQr(source));
      validatePaymentIntent(payload.intent, {
        network: 'testnet',
        latestLedger: pendingRequest ? stellarHealth.data?.latestLedger ?? 0 : 1_500_000,
        maxLedgerLifetime: 1_440,
      });
      if (!verifyMerchantSignature(payload)) {
        throw new Error('This request was not signed by the merchant it names');
      }
      navigation.navigate('Confirm', {payload});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'This payment request could not be read');
    }
  };
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.camera}>
        <View style={styles.scanFrame}><ScanLine color={colors.amber} size={52} /></View>
        <Text style={styles.cameraText}>Align the merchant QR inside the frame</Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button onPress={scanDemo} testID="scan-demo">{pendingRequest ? 'Scan this device request' : 'Scan demo QR'}</Button>
      <Text style={styles.fallback}>QR is the universal payment path on iOS and Android.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {justifyContent: 'center'},
  camera: {alignItems: 'center', alignSelf: 'center', aspectRatio: 0.82, backgroundColor: colors.black, borderRadius: radius.md, justifyContent: 'center', gap: spacing.xl, maxWidth: 420, width: '100%'},
  scanFrame: {alignItems: 'center', borderColor: colors.amber, borderRadius: radius.md, borderWidth: 3, height: 210, justifyContent: 'center', width: 210},
  cameraText: {...typography.label, color: colors.ink, maxWidth: 260, textAlign: 'center'},
  fallback: {fontSize: 13, lineHeight: 18, color: colors.inkMuted, textAlign: 'center'},
  error: {...typography.label, color: colors.danger, textAlign: 'center'},
});
