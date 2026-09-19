import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Check, ExternalLink, FlaskConical, Share2} from 'lucide-react-native';
import {Linking, Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, SplitText, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';

type Props = NativeStackScreenProps<RootStackParams, 'Receipt'>;

export function ReceiptScreen({route, navigation}: Props) {
  const {receipt} = route.params;
  const {width} = useWindowDimensions();
  // A demo settlement has no Stellar transaction, so it must never be presented
  // as an on-chain confirmation or link out to an explorer.
  const settled = receipt.settlementMode === 'testnet';
  return (
    <Screen contentStyle={styles.screen}>
      <AnimatedContent distance={8} scaleFrom={0.78} duration={560}><View style={[styles.successIcon, !settled && styles.demoIcon]}>{settled ? <Check color={colors.black} size={32} strokeWidth={3} /> : <FlaskConical color={colors.black} size={30} strokeWidth={2.5} />}</View></AnimatedContent>
      <AnimatedContent delay={100}><View style={styles.center}><Text style={[styles.eyebrow, !settled && styles.demoEyebrow]}>{settled ? 'PAYMENT COMPLETE' : 'DEMO PAYMENT'}</Text><SplitText delay={140} splitBy="word" style={styles.title} text={settled ? 'Payment confirmed' : 'Demo payment recorded'} /><Text style={styles.merchant}>{settled ? `Your payment to ${receipt.merchantName} was confirmed on Stellar.` : `Nothing was sent to Stellar. This is a local demo receipt for ${receipt.merchantName}.`}</Text></View></AnimatedContent>
      <AnimatedContent delay={180} scaleFrom={0.98}><SurfaceCard accent={settled ? 'success' : 'amber'} style={styles.amountCard}><Text style={styles.amount}>{receipt.amount} <Text style={styles.asset}>{receipt.assetCode}</Text></Text><StatusPill tone={settled ? 'success' : 'pending'}>{settled ? 'CONFIRMED' : 'DEMO ONLY'}</StatusPill></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={240}>
        <SurfaceCard padded={false} style={styles.receipt}>
          <Row label="Network" value={receipt.network === 'testnet' ? 'Stellar Testnet' : 'Stellar Public'} />
          <Row label="Intent ID" value={`${receipt.intentId.slice(0, 12)}...`} mono />
          <Row label={settled ? 'Transaction' : 'Demo reference'} value={`${receipt.transactionHash.slice(0, 16)}...`} mono />
          {settled && receipt.ledger !== undefined ? <Row label="Ledger" value={String(receipt.ledger)} mono /> : null}
          {settled && receipt.confirmedAt ? <Row label="Confirmed at" value={new Date(receipt.confirmedAt).toLocaleString()} /> : null}
          <Row label="Status" value={settled ? 'Confirmed' : 'Not settled on Stellar'} success={settled} />
        </SurfaceCard>
      </AnimatedContent>
      <AnimatedContent delay={300} distance={8}><View style={[styles.actions, width < 380 && styles.actionsStacked]}>{settled ? <Pressable accessibilityRole="link" style={styles.action} onPress={() => Linking.openURL(`https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}`)}><ExternalLink color={colors.amber} size={18} /><Text style={styles.actionText}>View on Explorer</Text></Pressable> : null}<Pressable accessibilityRole="button" style={styles.action}><Share2 color={colors.amber} size={18} /><Text style={styles.actionText}>Share receipt</Text></Pressable></View></AnimatedContent>
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
  demoIcon: {backgroundColor: colors.amber},
  demoEyebrow: {color: colors.amber},
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
  actionsStacked: {flexDirection: 'column'},
  action: {alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flex: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 48},
  actionText: {...typography.label, color: colors.ink, fontSize: 11},
});
