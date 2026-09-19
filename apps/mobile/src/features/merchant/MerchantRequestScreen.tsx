import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Copy, Share2, Store} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Button, colors, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import {encodePaymentQr} from '@rosapay/protocol';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {mockSignedIntent} from '../payments/mockIntent';

type Props = NativeStackScreenProps<RootStackParams, 'MerchantRequest'>;

export function MerchantRequestScreen({navigation}: Props) {
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.heading}><View style={styles.merchantIcon}><Store color={colors.amber} size={22} /></View><Text style={styles.eyebrow}>ROSE COFFEE</Text><Text style={styles.title}>Payment request</Text><Text style={styles.subtitle}>Show this code to your customer</Text></View>
      <SurfaceCard style={styles.requestCard}>
        <View style={styles.requestHeader}><View><Text style={styles.amount}>24.5 <Text style={styles.asset}>XLM</Text></Text><Text style={styles.reference}>Table 08</Text></View><StatusPill tone="pending">PENDING</StatusPill></View>
        <View style={styles.qr}><QRCode value={encodePaymentQr(mockSignedIntent)} size={214} color={colors.black} backgroundColor="#FFFFFF" /></View>
        <View style={styles.expiry}><View style={styles.dot} /><Text style={styles.expiryText}>Expires in 10 minutes</Text></View>
      </SurfaceCard>
      <View style={styles.actions}><Pressable style={styles.action}><Copy color={colors.amber} size={18} /><Text style={styles.actionText}>Copy link</Text></Pressable><Pressable style={styles.action}><Share2 color={colors.amber} size={18} /><Text style={styles.actionText}>Share QR</Text></Pressable></View>
      <Button onPress={() => navigation.navigate('Confirm', {payload: mockSignedIntent})}>Preview customer view</Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {justifyContent: 'center'},
  heading: {alignItems: 'center', gap: spacing.xs},
  merchantIcon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 44, justifyContent: 'center', marginBottom: spacing.sm, width: 44},
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.2},
  title: {...typography.title, color: colors.ink, fontSize: 26},
  subtitle: {color: colors.inkMuted, fontSize: 13},
  requestCard: {gap: spacing.md, marginTop: spacing.sm},
  requestHeader: {alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between'},
  amount: {color: colors.ink, fontSize: 28, fontWeight: '700'},
  asset: {color: colors.amber, fontSize: 15},
  reference: {color: colors.inkMuted, fontSize: 12, marginTop: spacing.xs},
  qr: {alignItems: 'center', alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: radius.sm, padding: spacing.lg},
  expiry: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  dot: {backgroundColor: colors.amber, borderRadius: radius.round, height: 8, width: 8},
  expiryText: {...typography.label, color: colors.inkMuted},
  actions: {flexDirection: 'row', gap: spacing.md},
  action: {alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flex: 1, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 48},
  actionText: {...typography.label, color: colors.ink},
});
