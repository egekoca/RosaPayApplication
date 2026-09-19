import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ScanLine} from 'lucide-react-native';
import {StyleSheet, Text, View} from 'react-native';
import {Button, colors, radius, spacing, typography} from '@rosapay/ui';
import {decodePaymentQr, encodePaymentQr, validatePaymentIntent} from '@rosapay/protocol';
import {verifyMerchantSignature} from '@rosapay/stellar/merchant-signature';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {mockSignedIntent} from './mockIntent';

type Props = NativeStackScreenProps<RootStackParams, 'Scan'>;

export function ScanScreen({navigation}: Props) {
  const scanDemo = () => {
    const payload = decodePaymentQr(encodePaymentQr(mockSignedIntent));
    validatePaymentIntent(payload.intent, {network: 'testnet', latestLedger: 1_500_000, maxLedgerLifetime: 300});
    if (!verifyMerchantSignature(payload)) {
      throw new Error('Merchant signature verification failed');
    }
    navigation.navigate('Confirm', {payload});
  };
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.camera}>
        <View style={styles.scanFrame}><ScanLine color={colors.amber} size={52} /></View>
        <Text style={styles.cameraText}>Align the merchant QR inside the frame</Text>
      </View>
      <Button onPress={scanDemo}>Scan demo QR</Button>
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
});
