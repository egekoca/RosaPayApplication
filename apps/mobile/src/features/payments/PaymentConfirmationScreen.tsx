import {useMutation} from '@tanstack/react-query';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {BadgeCheck, Fingerprint, ShieldCheck} from 'lucide-react-native';
import {StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, Pulse, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {useAppStore} from '../../state/appStore';
import {settlePaymentIntent} from './settlementAdapter';

type Props = NativeStackScreenProps<RootStackParams, 'Confirm'>;

export function PaymentConfirmationScreen({route, navigation}: Props) {
  const {payload} = route.params;
  const addReceipt = useAppStore(state => state.addReceipt);
  const mutation = useMutation({mutationFn: () => settlePaymentIntent(payload), onSuccess: receipt => {addReceipt(receipt); navigation.replace('Receipt', {receipt});}});
  const recipient = payload.intent.recipient;
  return (
    <Screen>
      <AnimatedContent><View style={styles.header}><View><Text style={styles.eyebrow}>SECURE CHECKOUT</Text><Text style={styles.title}>Review payment</Text></View><StatusPill tone="success">VERIFIED</StatusPill></View></AnimatedContent>
      <AnimatedContent delay={90} scaleFrom={0.98}><SurfaceCard accent="amber" style={styles.merchantCard}><View style={styles.merchant}><View style={styles.initial}><Text style={styles.initialText}>RC</Text></View><View style={styles.merchantCopy}><Text style={styles.merchantName}>{payload.intent.merchantName}</Text><View style={styles.verified}><BadgeCheck color={colors.success} size={16} /><Text style={styles.verifiedText}>Verified merchant</Text></View></View></View></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={150}><SurfaceCard style={styles.amountBlock}><Text style={styles.label}>YOU ARE PAYING</Text><Text style={styles.amount}>{payload.intent.amount} <Text style={styles.asset}>{payload.intent.asset.code}</Text></Text><Text style={styles.reference}>{payload.intent.reference}</Text></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={210}><SurfaceCard padded={false} style={styles.details}><Detail label="Network" value="Stellar Testnet" /><Detail label="Recipient" value={`${recipient.slice(0, 10)}...${recipient.slice(-8)}`} mono /><Detail label="Asset" value="Native XLM" /><Detail label="Expires" value="About 10 minutes" /></SurfaceCard></AnimatedContent>
      <Pulse active={mutation.isPending} style={styles.security}><ShieldCheck color={colors.success} size={18} /><Text style={styles.securityText}>Your device will authorize this exact amount.</Text></Pulse>
      {mutation.error && <Text style={styles.error}>Payment could not be authorized. No funds were moved.</Text>}
      <Button loading={mutation.isPending} icon={<Fingerprint color={colors.black} size={21} />} onPress={() => mutation.mutate()}>{mutation.isPending ? 'Confirming securely' : 'Approve payment'}</Button>
    </Screen>
  );
}

function Detail({label, value, mono}: {label: string; value: string; mono?: boolean}) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={[styles.detailValue, mono && styles.mono]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  header: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.1},
  title: {...typography.title, color: colors.ink, fontSize: 26, marginTop: 2},
  merchantCard: {paddingVertical: spacing.md},
  merchant: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  initial: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 44, justifyContent: 'center', width: 44},
  initialText: {color: colors.amber, fontSize: 14, fontWeight: '800'},
  merchantCopy: {gap: spacing.xs},
  merchantName: {...typography.title, color: colors.ink, fontSize: 17},
  verified: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs},
  verifiedText: {...typography.label, color: colors.success, fontSize: 12},
  amountBlock: {alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl},
  label: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.1},
  amount: {color: colors.ink, fontSize: 40, fontWeight: '700', lineHeight: 48, marginTop: spacing.sm},
  asset: {color: colors.amber, fontSize: 19},
  reference: {color: colors.inkMuted, fontSize: 13},
  details: {overflow: 'hidden'},
  detailRow: {alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: spacing.lg},
  detailLabel: {...typography.label, color: colors.inkMuted, fontSize: 12},
  detailValue: {...typography.label, color: colors.ink, flexShrink: 1, fontSize: 12, textAlign: 'right'},
  mono: {...typography.mono, fontSize: 11},
  security: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  securityText: {color: colors.success, fontSize: 12},
  error: {...typography.label, color: colors.danger},
});
