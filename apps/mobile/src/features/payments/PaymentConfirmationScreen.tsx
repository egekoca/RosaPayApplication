import {useCallback, useEffect, useMemo, useState} from 'react';
import {useMutation, useQuery} from '@tanstack/react-query';
import {useIsFocused} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ArrowLeftRight, BadgeCheck, Fingerprint, ShieldAlert, ShieldCheck} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, Pulse, radius, spacing, SplitText, StatusPill, Stepper, SurfaceCard, typography} from '@rosapay/ui';
import {verifyMerchantSignature} from '@rosapay/stellar/merchant-signature';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {exactAmount} from '../../shared/displayAmount';
import {RosaLoadingOverlay} from '../../shared/RosaMark';
import {useAppStore} from '../../state/appStore';
import {logger} from '../../shared/logger';
import type {SettlementPipelineProgress} from '@rosapay/stellar';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {settlePaymentIntent} from './settlementAdapter';
import {AssetMark} from '../home/AssetMark';
import {describeSettlementError, settlementErrorDetail} from './settlementErrors';
import {resolveFundingChoice, type FundingOption} from './fundingChoice';
import {useCurrentAccount} from '../wallet/currentAccount';
import {testnetDeployment} from '@rosapay/stellar';
import {createStellarConfig} from '@rosapay/stellar';
import {useTranslate} from '../../shared/i18n';
import {clock, useLedgerCountdown} from '../../shared/ledgerCountdown';

type Props = NativeStackScreenProps<RootStackParams, 'Confirm'>;

export function PaymentConfirmationScreen({route, navigation}: Props) {
  const t = useTranslate();
  // The scanner's legacy route carries only the payload; that path is QR.
  // Merchant preview also renders a QR request, so treating an omitted source
  // as QR keeps channel totals useful without changing the public payload.
  const {payload, transport = 'qr'} = route.params;
  const {intent} = payload;
  const {addReceipt} = useAppStore();
  const stellarHealth = useStellarHealth();
  const [stage, setStage] = useState<SettlementPipelineProgress['stage'] | undefined>();
  const [submittedHash, setSubmittedHash] = useState<string | undefined>();
  const account = useCurrentAccount();

  /**
   * What this wallet can actually pay with.
   *
   * A merchant may price in USDC while the phone holds only lumens. The
   * settlement contract can buy the difference through Soroswap on the way
   * past, so the question stops being "can you pay this" and becomes "out of
   * which of your moneys". Asking it here, before the fingerprint, is the whole
   * point: the number a customer needs is not the merchant's price but what
   * leaves their own wallet.
   */
  const funding = useQuery({
    queryKey: ['funding-choice', intent.intentId, account?.address],
    enabled: Boolean(account?.address),
    // A pool moves, so a quote goes stale; long enough to read the screen.
    staleTime: 30_000,
    queryFn: () =>
      resolveFundingChoice({
        intent,
        config: createStellarConfig('testnet'),
        customerAddress: account!.address,
        routerContractId: testnetDeployment.swap.routerContractId,
      }),
  });
  const [selectedAssetCode, setSelectedAssetCode] = useState<string | undefined>();
  const options = funding.data?.options ?? [];
  const payable = options.filter(option => option.kind !== 'unavailable');
  const selected =
    payable.find(option => option.asset.code === selectedAssetCode) ?? funding.data?.recommended;

  // A quote that reprices while the screen is open must not leave the customer
  // looking at one number and approving another.
  useEffect(() => {
    if (selectedAssetCode && !payable.some(option => option.asset.code === selectedAssetCode)) {
      setSelectedAssetCode(undefined);
    }
  }, [payable, selectedAssetCode]);

  const mutation = useMutation({
    mutationFn: () => {
      setStage(undefined);
      setSubmittedHash(undefined);
      return settlePaymentIntent(payload, {
        transport,
        ...(selected?.kind === 'swap' ? {funding: selected.funding} : {}),
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
  // The person deciding is the one under the clock. This row said "52 ledgers
  // left", which is true, checkable, and no help at all to someone working out
  // whether they have time to approve.
  const secondsLeft = useLedgerCountdown(remainingLedgers);
  const expired = remainingLedgers !== undefined && remainingLedgers <= 0;
  // Confirm can also be reached from merchant preview or a future deep link.
  // Those paths do not pass through readPaymentQr, so keep the Testnet-only
  // settlement boundary explicit before a biometric prompt can start.
  const wrongNetwork = intent.network !== 'testnet';
  // Nothing in this wallet can settle this request. Saying so before the
  // fingerprint is kinder than a failed transaction after it.
  const unaffordable = funding.isSuccess && payable.length === 0;
  const blocked =
    !verified ||
    wrongNetwork ||
    expired ||
    unaffordable ||
    funding.isPending ||
    funding.isError ||
    !selected ||
    latestLedger === undefined ||
    stellarHealth.isError ||
    // `isPending`, not `isFetching`: the ledger is re-read every five seconds,
    // and blocking on each background refetch would grey out Approve at random
    // and keep restarting the NFC authorization timer against a ledger the
    // screen already holds.
    stellarHealth.isPending;
  const screenFocused = useIsFocused();
  const issuer = intent.asset.issuer ?? intent.asset.contractId;
  const {mutate} = mutation;
  const startAuthorization = useCallback(() => mutate(), [mutate]);

  return (
    <>
    <Screen>
      <AnimatedContent><View style={styles.header}><View><Text style={styles.eyebrow}>{t('SECURE CHECKOUT')}</Text><SplitText delay={90} splitBy="word" style={styles.title} text={t('Review payment')} /></View><View style={styles.pills}><StatusPill tone="success">{t('TESTNET')}</StatusPill><StatusPill tone={verified ? 'success' : 'danger'}>{verified ? t('VERIFIED') : t('UNVERIFIED')}</StatusPill></View></View></AnimatedContent>
      <AnimatedContent delay={90} scaleFrom={0.98}><SurfaceCard accent="amber" style={styles.merchantCard}><View style={styles.merchant}><View style={styles.initial}><Text style={styles.initialText}>{initialsOf(intent.merchantName)}</Text></View><View style={styles.merchantCopy}><Text style={styles.merchantName}>{intent.merchantName}</Text><View style={styles.verified}>{verified ? <BadgeCheck color={colors.success} size={16} /> : <ShieldAlert color={colors.danger} size={16} />}<Text style={[styles.verifiedText, !verified && styles.unverifiedText]}>{verified ? t('Signature matches this merchant key') : t('Signature does not match this merchant key')}</Text></View></View></View></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={150}><SurfaceCard style={styles.amountBlock}><Text style={styles.label}>{t('YOU ARE PAYING')}</Text><View style={styles.amountLine}><AssetMark code={intent.asset.code} size={32} /><Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={styles.amount}>{exactAmount(intent.amount)} <Text style={styles.asset}>{intent.asset.code}</Text></Text></View><Text style={styles.reference}>{intent.reference}</Text></SurfaceCard></AnimatedContent>
      <AnimatedContent delay={180}>
        <FundingPanel
          intentAsset={intent.asset.code}
          loading={funding.isPending}
          onSelect={setSelectedAssetCode}
          options={options}
          selected={selected}
          t={t}
        />
      </AnimatedContent>
      <AnimatedContent delay={210}>
        <SurfaceCard padded={false} style={styles.details}>
          <Detail label={t('Network')} value={intent.network === 'testnet' ? 'Stellar Testnet' : 'Stellar Public'} />
          <Detail label={t('Asset')} value={intent.asset.type === 'native' ? t('Native XLM') : `${intent.asset.code} (${intent.asset.type.toUpperCase()})`} />
          {issuer ? <Detail label={t('Issuer')} value={issuer} mono selectable /> : null}
          <Detail label={t('Expires')} value={expiryLabel(secondsLeft, intent.expiresAtLedger, stellarHealth.isError, t)} />
          <Detail label={t('Recipient')} value={intent.recipient} mono selectable last />
        </SurfaceCard>
      </AnimatedContent>
      <Text style={styles.recipientHint}>{t('Long-press the recipient or issuer to copy it.')}</Text>
      {mutation.isPending || mutation.isError ? (
        <Stepper activeIndex={stageIndex(stage)} failed={mutation.isError} steps={settlementSteps.map(step => ({...step, label: t(step.label)}))} />
      ) : (
        <Pulse active={false} style={styles.security}><ShieldCheck color={blocked ? colors.inkMuted : colors.success} size={18} /><Text style={[styles.securityText, blocked && styles.securityTextBlocked]}>{blocked ? t('This request cannot be authorized.') : t('Your device will authorize this exact amount.')}</Text></Pulse>
      )}
      {!verified && <Text style={styles.error}>{t('The merchant signature failed verification. Ask for a new payment request.')}</Text>}
      {verified && wrongNetwork ? <Text style={styles.error}>{t('This request is no longer valid: it has expired or targets another network.')}</Text> : null}
      {verified && !expired && unaffordable ? (
        <Text style={styles.error}>{`${t('This wallet cannot cover this request in')} ${intent.asset.code} ${t('or in anything it can be exchanged for.')}`}</Text>
      ) : null}
      {funding.isError ? (
        <>
          <Text style={styles.error}>{t('The wallet balance could not be verified, so this payment is paused.')}</Text>
          <Button tone="secondary" onPress={() => void funding.refetch()} testID="retry-funding-check">
            {t('Retry balance check')}
          </Button>
        </>
      ) : null}
      {stellarHealth.isError ? (
        <Text style={styles.error}>{t('Testnet is unavailable, so this request expiry cannot be verified.')}</Text>
      ) : null}
      {verified && expired && <Text style={styles.error}>{`${t('This request expired at ledger')} ${intent.expiresAtLedger}. ${t('Ask for a new one.')}`}</Text>}
      {submittedHash ? (
        <Text selectable style={styles.submitted}>{t('Sent to Stellar:')} {submittedHash.slice(0, 16)}…</Text>
      ) : null}
      {mutation.error ? (
        <>
          <Text style={styles.error}>{t(describeSettlementError(mutation.error, intent.asset.code))}</Text>
          {/*
            What actually went wrong, in the words the code used. A phone has no
            console, so without this line a failure nobody anticipated reaches
            the person holding it as one sentence and takes its cause with it.
            Selectable, because reporting it means copying it.
          */}
          {settlementErrorDetail(mutation.error) ? (
            <Text selectable style={styles.errorDetail} testID="settlement-error-detail">
              {settlementErrorDetail(mutation.error)}
            </Text>
          ) : null}
        </>
      ) : null}
      <Button disabled={blocked} loading={mutation.isPending} icon={<Fingerprint color={colors.black} size={21} />} onPress={startAuthorization} testID="approve-payment">{mutation.isPending ? t(stageLabel(stage)) : mutation.isError ? t('Retry payment') : t('Approve payment')}</Button>
    </Screen>
    <RosaLoadingOverlay
      detail={t(settlementDetail(stage))}
      title={t(stageLabel(stage))}
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

function expiryLabel(secondsLeft: number | undefined, expiresAtLedger: number, unavailable: boolean, t: (text: string) => string): string {
  if (unavailable) return `${t('At ledger')} ${expiresAtLedger} (${t('network unreachable')})`;
  if (secondsLeft === undefined) return `${t('At ledger')} ${expiresAtLedger}`;
  if (secondsLeft <= 0) return t('Expired');
  return `${clock(secondsLeft)} ${t('left to pay')}`;
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


/**
 * What leaves this wallet, and out of which money.
 *
 * With one payable asset this is a statement, not a choice, and it renders as a
 * single line. It only becomes a picker when the wallet genuinely holds more
 * than one thing that could settle the bill - a choice offered where there is
 * none is just another thing to read.
 *
 * The merchant's amount is deliberately not repeated here. It is already the
 * large number above, and this panel exists to answer the other question.
 */
function FundingPanel({
  intentAsset,
  loading,
  onSelect,
  options,
  selected,
  t,
}: {
  intentAsset: string;
  loading: boolean;
  onSelect(code: string): void;
  options: FundingOption[];
  selected: FundingOption | undefined;
  t: (text: string) => string;
}) {
  const payable = options.filter(option => option.kind !== 'unavailable');

  if (loading) {
    return (
      <SurfaceCard style={styles.funding}>
        <Text style={styles.fundingLabel}>{t('PAYING WITH')}</Text>
        <Text style={styles.fundingHint}>{t('Checking what this wallet can pay with…')}</Text>
      </SurfaceCard>
    );
  }
  if (!selected || payable.length === 0) return null;
  // The customer already holds what was asked for; there is nothing to explain.
  if (selected.kind === 'direct' && payable.length === 1) return null;

  return (
    <SurfaceCard style={styles.funding}>
      <View style={styles.fundingHeader}>
        <Text style={styles.fundingLabel}>{t('PAYING WITH')}</Text>
        {selected.kind === 'swap' ? (
          <View style={styles.fundingBadge}>
            <ArrowLeftRight color={colors.amber} size={12} />
            <Text style={styles.fundingBadgeText}>{t('via Soroswap')}</Text>
          </View>
        ) : null}
      </View>

      {payable.length > 1 ? (
        <View style={styles.fundingChoices}>
          {payable.map(option => {
            const active = option.asset.code === selected.asset.code;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                key={option.asset.code}
                onPress={() => onSelect(option.asset.code)}
                style={[styles.fundingChip, active && styles.fundingChipActive]}
                testID={`funding-${option.asset.code}`}>
                <Text style={[styles.fundingChipText, active && styles.fundingChipTextActive]}>
                  {option.asset.code}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.fundingSpend}>
        {exactAmount(selected.kind === 'unavailable' ? '0' : selected.spend)}{' '}
        <Text style={styles.fundingSpendAsset}>{selected.asset.code}</Text>
      </Text>

      {selected.kind === 'swap' ? (
        <>
          <Text style={styles.fundingHint}>
            {`${t('Exchanged for the')} ${intentAsset} ${t('the merchant asked for, at')} ${selected.rate}.`}
          </Text>
          {/* The ceiling is the number that is actually signed, so it is shown
              rather than left implicit: above it the payment fails instead of
              costing more. */}
          <Text style={styles.fundingHint}>
            {`${t('You will never pay more than')} ${exactAmount(selected.maxSpend)} ${selected.asset.code}.`}
          </Text>
        </>
      ) : (
        <Text style={styles.fundingHint}>{t('Held directly in this wallet.')}</Text>
      )}
    </SurfaceCard>
  );
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
  amountLine: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
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
  funding: {gap: spacing.sm},
  fundingHeader: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  fundingLabel: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.1},
  fundingBadge: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3},
  fundingBadgeText: {...typography.label, color: colors.amber, fontSize: 10},
  fundingChoices: {flexDirection: 'row', gap: spacing.sm},
  fundingChip: {borderColor: colors.line, borderRadius: radius.round, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.xs},
  fundingChipActive: {backgroundColor: colors.amberSoft, borderColor: colors.amber},
  fundingChipText: {...typography.label, color: colors.inkMuted, fontSize: 12},
  fundingChipTextActive: {color: colors.amber},
  fundingSpend: {color: colors.ink, fontSize: 26, fontWeight: '700'},
  fundingSpendAsset: {color: colors.amber, fontSize: 15},
  fundingHint: {color: colors.inkMuted, fontSize: 12},
  security: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  securityText: {color: colors.success, fontSize: 12},
  error: {...typography.label, color: colors.danger},
  errorDetail: {...typography.mono, color: colors.inkFaint, fontSize: 10, lineHeight: 14, marginTop: spacing.xs},
});
