import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Check, ExternalLink, Share2} from 'lucide-react-native';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';

type Props = NativeStackScreenProps<RootStackParams, 'Receipt'>;

export function ReceiptScreen({route, navigation}: Props) {
  const {receipt} = route.params;
  return (
    <Screen contentStyle={styles.screen}>
      <AnimatedContent distance={8} scaleFrom={0.78} duration={560}><View style={styles.successIcon}><Check color={colors.black} size={32} strokeWidth={3} /></View></AnimatedContent>
      <AnimatedContent delay={100}><View style={styles.center}><Text style={styles.eyebrow}>PAYMENT COMPLETE</Text><Text style={styles.title}>Payment confirmed</Text><Text style={styles.merchant}>Your payment to {receipt.merchantName} was submitted.</Text></View></AnimatedContent>
      <AnimatedContent delay={180} scaleFrom={0.98}><SurfaceCard accent="success" style={styles.amountCard}><Text style={styles.amount}>{receipt.amount} <Text style={styles.asset}>{receipt.assetCode}</Text></Text><StatusPill tone="success">CONFIRMED</StatusPill></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={240}><SurfaceCard padded={false} style={styles.receipt}><Row label="Network" value="Stellar Testnet" /><Row label="Intent ID" value={`${receipt.intentId.slice(0, 12)}...`} mono /><Row label="Transaction" value={`${receipt.transactionHash.slice(0, 12)}...`} mono /><Row label="Status" value="Confirmed" success /></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={300} distance={8}><View style={styles.actions}><Pressable style={styles.action} onPress={() => Linking.openURL(`https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}`)}><ExternalLink color={colors.amber} size={18} /><Text style={styles.actionText}>View on Explorer</Text></Pressable><Pressable style={styles.action}><Share2 color={colors.amber} size={18} /><Text style={styles.actionText}>Share receipt</Text></Pressable></View></AnimatedContent>
      <AnimatedContent delay={360} distance={8}><Button onPress={() => navigation.popToTop()}>Done</Button></AnimatedContent>
    </Screen>
  );
}

function Row({label, value, mono, success}: {label: string; value: string; mono?: boolean; success?: boolean}) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={[styles.value, mono && styles.mono, success && styles.success]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: {alignItems: 'stretch', justifyContent: 'center'},
  successIcon: {alignItems: 'center', alignSelf: 'center', backgroundColor: colors.success, borderRadius: radius.round, height: 68, justifyContent: 'center', width: 68},
  center: {alignItems: 'center', gap: spacing.xs},
  eyebrow: {...typography.label, color: colors.success, fontSize: 10, letterSpacing: 1.1},
  title: {...typography.title, color: colors.ink, fontSize: 25, marginTop: spacing.xs},
  merchant: {color: colors.inkMuted, fontSize: 13, textAlign: 'center'},
  amountCard: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  amount: {color: colors.ink, fontSize: 28, fontWeight: '700'},
  asset: {color: colors.amber, fontSize: 15},
  receipt: {overflow: 'hidden'},
  row: {alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: spacing.lg},
  label: {...typography.label, color: colors.inkMuted, fontSize: 12},
  value: {...typography.label, color: colors.ink, flexShrink: 1, fontSize: 12},
  mono: {...typography.mono, fontSize: 11},
  success: {color: colors.success},
  actions: {flexDirection: 'row', gap: spacing.md},
  action: {alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flex: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 48},
  actionText: {...typography.label, color: colors.ink, fontSize: 11},
});
