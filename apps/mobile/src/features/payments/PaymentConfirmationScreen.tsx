import {useMemo, useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {BadgeCheck, Fingerprint, ShieldAlert, ShieldCheck} from 'lucide-react-native';
import {StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, Pulse, radius, spacing, SplitText, StatusPill, Stepper, SurfaceCard, typography} from '@rosapay/ui';
import {verifyMerchantSignature} from '@rosapay/stellar/merchant-signature';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {exactAmount} from '../../shared/displayAmount';
import {LumenadeLoadingOverlay} from '../../shared/LumenadeMark';
import {useAppStore} from '../../state/appStore';
import {logger} from '../../shared/logger';
import type {SettlementPipelineProgress} from '@rosapay/stellar';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {settlePaymentIntent} from './settlementAdapter';
import {describeSettlementError} from './settlementErrors';

type Props = NativeStackScreenProps<RootStackParams, 'Confirm'>;

export function PaymentConfirmationScreen({route, navigation}: Props) {
  const {payload} = route.params;
  const {intent} = payload;
  const {addReceipt} = useAppStore();
  const stellarHealth = useStellarHealth();
  const [stage, setStage] = useState<SettlementPipelineProgress['stage'] | undefined>();
  const [submittedHash, setSubmittedHash] = useState<string | undefined>();
  const mutation = useMutation({
    mutationFn: () => {
      setStage(undefined);
      setSubmittedHash(undefined);
      return settlePaymentIntent(payload, {
        onProgress: progress => {
          setStage(progress.stage);
          if (progress.transactionHash) setSubmittedHash(progress.transactionHash);
        },
      });
    },
    onSuccess: receipt => {
      addReceipt(receipt);
      navigation.replace('Receipt', {receipt});
    },
    onError: error => {
      logger.error('settlement_failed', {
        stage,
        name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.slice(0, 800) : undefined,
      });
    },
  });

  // The signature is re-checked here, not only at scan time, so a payload that
  // was altered in between can never reach the authorization step.
  const verified = useMemo(() => verifyMerchantSignature(payload), [payload]);
  const latestLedger = stellarHealth.data?.latestLedger;
  const remainingLedgers = latestLedger === undefined ? undefined : intent.expiresAtLedger - latestLedger;
  const expired = remainingLedgers !== undefined && remainingLedgers <= 0;
  const blocked = !verified || expired;
  const issuer = intent.asset.issuer ?? intent.asset.contractId;

  return (
    <>
    <Screen>
      <AnimatedContent><View style={styles.header}><View><Text style={styles.eyebrow}>SECURE CHECKOUT</Text><SplitText delay={90} splitBy="word" style={styles.title} text="Review payment" /></View><View style={styles.pills}><StatusPill tone="success">TESTNET</StatusPill><StatusPill tone={verified ? 'success' : 'danger'}>{verified ? 'VERIFIED' : 'UNVERIFIED'}</StatusPill></View></View></AnimatedContent>
      <AnimatedContent delay={90} scaleFrom={0.98}><SurfaceCard accent="amber" style={styles.merchantCard}><View style={styles.merchant}><View style={styles.initial}><Text style={styles.initialText}>{initialsOf(intent.merchantName)}</Text></View><View style={styles.merchantCopy}><Text style={styles.merchantName}>{intent.merchantName}</Text><View style={styles.verified}>{verified ? <BadgeCheck color={colors.success} size={16} /> : <ShieldAlert color={colors.danger} size={16} />}<Text style={[styles.verifiedText, !verified && styles.unverifiedText]}>{verified ? 'Signature matches this merchant key' : 'Signature does not match this merchant key'}</Text></View></View></View></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={150}><SurfaceCard style={styles.amountBlock}><Text style={styles.label}>YOU ARE PAYING</Text><Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={styles.amount}>{exactAmount(intent.amount)} <Text style={styles.asset}>{intent.asset.code}</Text></Text><Text style={styles.reference}>{intent.reference}</Text></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={210}>
        <SurfaceCard padded={false} style={styles.details}>
          <Detail label="Network" value={intent.network === 'testnet' ? 'Stellar Testnet' : 'Stellar Public'} />
          <Detail label="Asset" value={intent.asset.type === 'native' ? 'Native XLM' : `${intent.asset.code} (${intent.asset.type.toUpperCase()})`} />
          {issuer ? <Detail label="Issuer" value={issuer} mono selectable /> : null}
          <Detail label="Expires" value={expiryLabel(remainingLedgers, intent.expiresAtLedger, stellarHealth.isError)} />
          <Detail label="Recipient" value={intent.recipient} mono selectable last />
        </SurfaceCard>
      </AnimatedContent>
      <Text style={styles.recipientHint}>Long-press the recipient or issuer to copy it.</Text>
      {mutation.isPending || mutation.isError ? (
        <Stepper activeIndex={stageIndex(stage)} failed={mutation.isError} steps={settlementSteps} />
      ) : (
        <Pulse active={false} style={styles.security}><ShieldCheck color={blocked ? colors.inkMuted : colors.success} size={18} /><Text style={[styles.securityText, blocked && styles.securityTextBlocked]}>{blocked ? 'This request cannot be authorized.' : 'Your device will authorize this exact amount.'}</Text></Pulse>
      )}
      {!verified && <Text style={styles.error}>The merchant signature failed verification. Ask for a new payment request.</Text>}
      {verified && expired && <Text style={styles.error}>This request expired at ledger {intent.expiresAtLedger}. Ask for a new one.</Text>}
      {submittedHash ? (
        <Text selectable style={styles.submitted}>Sent to Stellar: {submittedHash.slice(0, 16)}…</Text>
      ) : null}
      {mutation.error ? <Text style={styles.error}>{describeSettlementError(mutation.error, intent.asset.code)}</Text> : null}
      <Button disabled={blocked} loading={mutation.isPending} icon={<Fingerprint color={colors.black} size={21} />} onPress={() => mutation.mutate()} testID="approve-payment">{mutation.isPending ? stageLabel(stage) : 'Approve payment'}</Button>
    </Screen>
    <LumenadeLoadingOverlay
      detail={settlementDetail(stage)}
      title={stageLabel(stage)}
      visible={mutation.isPending}
    />
    </>
  );
}

const settlementSteps = [
  {key: 'prepare', label: 'Prepare'},
  {key: 'authorize', label: 'Authorize'},
  {key: 'submit', label: 'Submit'},
  {key: 'confirm', label: 'Confirm'},
] as const;

function stageIndex(stage: SettlementPipelineProgress['stage'] | undefined): number {
  switch (stage) {
    case 'simulated':
      return 1;
    case 'authorized':
      return 2;
    case 'submitted':
      return 3;
    case 'confirmed':
      return 3;
    default:
      return 0;
  }
}

function stageLabel(stage: SettlementPipelineProgress['stage'] | undefined): string {
  switch (stage) {
    case 'simulated':
      return 'Preparing authorization';
    case 'authorized':
      return 'Sending to the relayer';
    case 'submitted':
      return 'Waiting for the ledger';
    case 'confirmed':
      return 'Confirmed';
    default:
      return 'Authorizing on this device';
  }
}

function settlementDetail(stage: SettlementPipelineProgress['stage'] | undefined): string {
  switch (stage) {
    case 'simulated':
      return 'The exact amount and recipient are ready for device authorization.';
    case 'authorized':
      return 'Your authorization is locked. The relayer cannot change the payment.';
    case 'submitted':
      return 'The transaction is submitted. Waiting for a final Stellar ledger result.';
    case 'confirmed':
      return 'The payment reached a confirmed Stellar ledger.';
    default:
      return 'Approve the exact payment with your device security.';
  }
}

function expiryLabel(remainingLedgers: number | undefined, expiresAtLedger: number, unavailable: boolean): string {
  if (unavailable) return `At ledger ${expiresAtLedger} (network unreachable)`;
  if (remainingLedgers === undefined) return `At ledger ${expiresAtLedger}`;
  if (remainingLedgers <= 0) return 'Expired';
  return `${remainingLedgers} ledgers left (about ${Math.max(1, Math.round((remainingLedgers * 5) / 60))} min)`;
}

function initialsOf(merchantName: string): string {
  const initials = merchantName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() ?? '')
    .join('');
  return initials || '??';
}

function Detail({label, value, mono, selectable, last}: {label: string; value: string; mono?: boolean; selectable?: boolean; last?: boolean}) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable={selectable} style={[styles.detailValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  pills: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
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
  amountBlock: {alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl},
  label: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.1},
  amount: {color: colors.ink, fontSize: 40, fontWeight: '700', lineHeight: 48, marginTop: spacing.sm, textAlign: 'center', width: '100%'},
  asset: {color: colors.amber, fontSize: 19},
  reference: {color: colors.inkMuted, fontSize: 13, textAlign: 'center'},
  details: {overflow: 'hidden'},
  detailRow: {alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', minHeight: 50, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm},
  detailRowLast: {borderBottomWidth: 0},
  recipientHint: {color: colors.inkMuted, fontSize: 11, marginTop: -spacing.sm},
  unverifiedText: {color: colors.danger},
  securityTextBlocked: {color: colors.inkMuted},
  submitted: {...typography.mono, color: colors.inkMuted, fontSize: 11, textAlign: 'center'},
  detailLabel: {...typography.label, color: colors.inkMuted, fontSize: 12},
  detailValue: {...typography.label, color: colors.ink, flexShrink: 1, fontSize: 12, textAlign: 'right'},
  mono: {...typography.mono, fontSize: 11},
  security: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  securityText: {color: colors.success, fontSize: 12},
  error: {...typography.label, color: colors.danger},
});
