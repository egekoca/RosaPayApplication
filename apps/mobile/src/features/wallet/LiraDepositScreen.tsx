import {useCallback, useEffect, useRef, useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ArrowDown, Banknote, Building2, Copy, Landmark, ShieldCheck} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {displayAmount} from '../../shared/displayAmount';
import {shareValue} from '../../shared/shareAddress';
import {useWalletBalance} from '../../shared/useWalletBalance';
import {useCurrentAccount} from './currentAccount';
import {useTranslate} from '../../shared/i18n';
import {AssetMark} from '../home/AssetMark';
import {
  IS_SANDBOX_ANCHOR,
  LiraRampError,
  quoteLiraDeposit,
  quoteLiraWithdrawal,
  readLiraTransfer,
  simulateBankTransfer,
  startLiraDeposit,
  startLiraWithdrawal,
  type LiraQuote,
  type LiraWithdrawalQuote,
  type StartedLiraDeposit,
  type StartedLiraWithdrawal,
} from './liraRamp';

type Props = NativeStackScreenProps<RootStackParams, 'LiraDeposit'>;

/** How often the anchor is asked whether the money has moved. */
const POLL_MS = 3_000;

type Direction = 'add' | 'cash-out';

/**
 * Lira in and lira out, on one screen.
 *
 * Both directions are the same conversation with the same anchor, so splitting
 * them would duplicate the rate, the sign-in and the status polling. What
 * differs is who moves first: adding money ends with the customer at their
 * bank, cashing out ends with the anchor at theirs.
 *
 * The rate shown is always the one including the anchor's spread, because the
 * pre-fee rate is a number nobody receives.
 *
 * Only a recovery-phrase account can be here. The anchor authenticates with
 * SEP-10 and publishes no SEP-45, so a contract account cannot prove itself to
 * it — the screen says so on arrival rather than failing at the last step.
 */
export function LiraDepositScreen({navigation}: Props) {
  const t = useTranslate();
  const account = useCurrentAccount();
  const balance = useWalletBalance();
  const usdcHeld = balance.data?.find(holding => holding.code === 'USDC')?.amount ?? '0';

  const [direction, setDirection] = useState<Direction>('add');
  const [amount, setAmount] = useState('500');
  const [quote, setQuote] = useState<LiraQuote>();
  const [payout, setPayout] = useState<LiraWithdrawalQuote>();
  const [started, setStarted] = useState<StartedLiraDeposit>();
  const [withdrawal, setWithdrawal] = useState<StartedLiraWithdrawal>();
  const [status, setStatus] = useState<string>();
  const [received, setReceived] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const polling = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const supported = account?.kind === 'classic';
  const open = started ?? withdrawal;
  const unit = direction === 'add' ? 'TRY' : 'USDC';

  /*
   * Said before the button rather than after the fingerprint. The device
   * prompt is what this screen spends of the customer's patience, and spending
   * it to report a number they could have been told about is the wrong order.
   */
  /*
   * One line for the terms, the way an exchange window carries a board: the
   * rate, then what the anchor keeps. Named as a rate rather than buried in a
   * sentence, because it is the number to compare against another counter.
   */
  const rate = direction === 'add' ? quote?.perUsdc : payout?.perUsdc;
  const fee = direction === 'add' ? quote?.feeTotal : payout?.feeTotal;
  const rateLine = rate
    ? `1 USDC = ₺${displayAmount(rate)}${fee ? `  ·  ${t('fee')} ₺${displayAmount(fee)}` : ''}`
    : t('Reading the rate…');

  const entered = Number(amount);
  const overspending = direction === 'cash-out' && entered > Number(usdcHeld);
  const payable = amount.trim().length > 0 && Number.isFinite(entered) && entered > 0 && !overspending;

  useEffect(() => () => clearInterval(polling.current), []);

  // The bar said "Add lira" over a screen headed "Take out lira", which is the
  // kind of contradiction that makes someone check they tapped the right thing.
  useEffect(() => {
    navigation.setOptions({title: direction === 'add' ? t('Add lira') : t('Cash out')});
  }, [direction, navigation, t]);

  useEffect(() => {
    if (!amount.trim() || !supported || open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (direction === 'add') {
          const next = await quoteLiraDeposit(amount.trim());
          if (!cancelled) setQuote(next);
        } else {
          const next = await quoteLiraWithdrawal(amount.trim());
          if (!cancelled) setPayout(next);
        }
      } catch {
        // A rate that will not load is not worth a red banner while someone is
        // still typing; the button reports it if they go on.
        if (!cancelled) {
          setQuote(undefined);
          setPayout(undefined);
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount, supported, direction, open]);

  const poll = useCallback(
    (transfer: {transferServer: string; transactionId: string; session: StartedLiraDeposit['session']}) => {
      clearInterval(polling.current);
      polling.current = setInterval(async () => {
        try {
          const next = await readLiraTransfer(transfer);
          setStatus(next.status);
          if (next.settled || next.failed) {
            clearInterval(polling.current);
            if (next.amountOut) setReceived(next.amountOut);
            void balance.refetch();
          }
        } catch {
          // Left running: a dropped poll is not a failed transfer, and the
          // anchor is the one holding the answer.
        }
      }, POLL_MS);
    },
    [balance],
  );

  const begin = async () => {
    if (!account) return;
    setBusy(true);
    setError(undefined);
    try {
      if (direction === 'add') {
        const deposit = await startLiraDeposit({
          address: account.address,
          amountTry: amount.trim(),
          reason: `Add ${amount.trim()} TRY to Lumenade Pay`,
        });
        setStarted(deposit);
        setStatus('pending_user_transfer_start');
        poll(deposit);
      } else {
        const sent = await startLiraWithdrawal({
          address: account.address,
          amountUsdc: amount.trim(),
          available: usdcHeld,
          reason: `Cash out ${amount.trim()} USDC to lira`,
        });
        setWithdrawal(sent);
        setStatus('pending_anchor');
        poll(sent);
      }
    } catch (failure) {
      setError(
        failure instanceof LiraRampError || failure instanceof Error
          ? failure.message
          : 'That could not be started',
      );
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    if (!started) return;
    setBusy(true);
    setError(undefined);
    try {
      await simulateBankTransfer(started);
      setStatus('pending_anchor');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The sandbox bank did not answer');
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <Screen>
        <AnimatedContent>
          <View style={styles.hero}>
            <View style={styles.icon}><Banknote color={colors.amber} size={22} /></View>
            <Text style={styles.title}>{t('Lira needs a recovery-phrase wallet')}</Text>
            <Text style={styles.subtitle}>
              {t("The anchor verifies a wallet by having it sign a challenge, which only an ordinary Stellar account can do. This phone's wallet lives in its secure hardware and has no key that can answer. Set this phone up again with a recovery phrase to move money in lira.")}
            </Text>
          </View>
        </AnimatedContent>
        <AnimatedContent delay={90}>
          <Button onPress={() => navigation.goBack()}>{t('Go back')}</Button>
        </AnimatedContent>
      </Screen>
    );
  }

  return (
    <Screen>
      {/*
        The eyebrow, the icon and the paragraph were three ways of saying what
        the segmented control below already says, stacked above the only thing
        anyone came here to see. They are gone; the screen opens on the money.
      */}

      {!open ? (
        <>
          <AnimatedContent delay={60}>
            <View style={styles.directionRow}>
              <DirectionPill
                label={t('Add money')}
                onPress={() => {
                  setDirection('add');
                  setAmount('500');
                }}
                selected={direction === 'add'}
                testID="direction-add"
              />
              <DirectionPill
                label={t('Cash out')}
                onPress={() => {
                  setDirection('cash-out');
                  setAmount(usdcHeld === '0' ? '' : usdcHeld);
                }}
                selected={direction === 'cash-out'}
                testID="direction-cash-out"
              />
            </View>
          </AnimatedContent>

          {/*
            An exchange counter, not a form: what you hand over above, what you
            get back below, and the rate between them at the bottom where a
            board would carry it. The answer used to be a grey line under a text
            field, which made the one number somebody came for the smallest
            thing on the screen.
          */}
          <AnimatedContent delay={80} scaleFrom={0.99}>
            <View style={styles.counter}>
              <View style={styles.side}>
                <Text style={styles.sideLabel}>{t('YOU SEND')}</Text>
                <View style={styles.sideRow}>
                  <Text style={styles.mark}>{direction === 'add' ? '₺' : '$'}</Text>
                  <TextInput
                    keyboardType="decimal-pad"
                    maxLength={14}
                    onChangeText={setAmount}
                    placeholder={direction === 'add' ? '500' : '10'}
                    placeholderTextColor={colors.inkFaint}
                    style={styles.sideInput}
                    testID="lira-amount"
                    value={amount}
                  />
                  <Text style={styles.sideUnit}>{unit}</Text>
                </View>
                {direction === 'cash-out' ? (
                  <Text style={[styles.held, overspending && styles.heldWarning]}>
                    {overspending
                      ? `${t('Only')} ${displayAmount(usdcHeld)} USDC ${t('in this wallet')}`
                      : `${displayAmount(usdcHeld)} USDC ${t('in this wallet')}`}
                  </Text>
                ) : null}
              </View>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <View style={styles.dividerMark}>
                  <ArrowDown color={colors.goldBright} size={15} strokeWidth={2.6} />
                </View>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.side}>
                <Text style={styles.sideLabel}>{t('YOU GET')}</Text>
                <View style={styles.sideRow}>
                  {/* The app's own mark for an asset, the flag for a currency. */}
                  {direction === 'add' ? (
                    <AssetMark code="USDC" size={30} />
                  ) : (
                    <Text style={styles.flag}>🇹🇷</Text>
                  )}
                  <Text
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={styles.receive}
                    testID={direction === 'add' ? 'lira-quote' : 'lira-payout'}>
                    {direction === 'add'
                      ? quote
                        ? displayAmount(quote.buyAmount)
                        : '—'
                      : payout
                        ? `₺${displayAmount(payout.buyAmount)}`
                        : '₺—'}
                  </Text>
                  <Text style={styles.sideUnit}>{direction === 'add' ? 'USDC' : 'TRY'}</Text>
                </View>
              </View>
            </View>
          </AnimatedContent>

          <AnimatedContent delay={120}>
            <Text style={styles.terms}>
              {rateLine}
            </Text>
          </AnimatedContent>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <AnimatedContent delay={160}>
            <Button
              disabled={!payable}
              loading={busy}
              onPress={() => void begin()}
              testID="open-lira-transfer">
              {direction === 'add' ? t('Continue') : t('Send and cash out')}
            </Button>
          </AnimatedContent>
        </>
      ) : (
        <>
          <AnimatedContent delay={80} scaleFrom={0.99}>
            <View style={styles.receipt}>
              {started ? (
                <>
                  <Instruction
                    icon={<Building2 color={colors.goldBright} size={18} />}
                    label={t('SEND TO')}
                    onCopy={() => void shareValue('Anchor IBAN', started.instructions.iban ?? '')}
                    title={started.instructions.bankName ?? t('The anchor’s bank')}
                    {...(started.instructions.iban ? {value: started.instructions.iban} : {})}
                  />
                  <View style={styles.separator} />
                  <Instruction
                    body={t('Write this in the transfer description. It is what routes the money to your wallet.')}
                    icon={<ShieldCheck color={colors.success} size={18} />}
                    label={t('REFERENCE (AÇIKLAMA)')}
                    onCopy={() => void shareValue('Transfer reference', started.instructions.reference ?? '')}
                    {...(started.instructions.reference ? {value: started.instructions.reference} : {})}
                  />
                </>
              ) : withdrawal ? (
                <Instruction
                  body={`${displayAmount(withdrawal.amountUsdc)} ${t('USDC has been sent to the anchor. It pays the lira out once it sees the payment.')}`}
                  icon={<Landmark color={colors.goldBright} size={18} />}
                  label={t('PAID OUT TO')}
                  {...(withdrawal.bankAccount
                    ? {value: withdrawal.bankAccount}
                    : {title: t('Your registered bank account')})}
                />
              ) : null}
            </View>
          </AnimatedContent>

          <AnimatedContent delay={150}>
            <View style={styles.status}>
              <Text style={styles.instructionLabel}>{t('STATUS')}</Text>
              <Text style={styles.statusValue} testID="lira-status">
                {t(readableStatus(status, direction))}
              </Text>
              {received ? (
                <Text style={styles.received} testID="lira-received">
                  {displayAmount(received)} {direction === 'add' ? t('USDC arrived in this wallet.') : t('TRY was paid out.')}
                </Text>
              ) : null}
            </View>
          </AnimatedContent>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/*
            Only the sandbox has a bank that can be told to pretend. Against a
            real anchor this button would post to an endpoint that does not
            exist, next to a customer waiting for a transfer they must actually
            send.
          */}
          {IS_SANDBOX_ANCHOR && started && status === 'pending_user_transfer_start' ? (
            <AnimatedContent delay={210}>
              {/*
                A sandbox affordance, named for what it is. There is no real bank
                behind this anchor, so nothing else would ever move the money.
              */}
              <Button loading={busy} onPress={() => void simulate()} testID="simulate-bank-transfer">
                {t('Simulate the bank transfer')}
              </Button>
            </AnimatedContent>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/** One direction of the ramp. Plain, because it is a choice, not a feature. */
function DirectionPill({
  label,
  onPress,
  selected,
  testID,
}: {
  label: string;
  onPress(): void;
  selected: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{selected}}
      onPress={onPress}
      style={[styles.directionPill, selected && styles.directionPillSelected]}
      testID={testID}>
      <Text style={[styles.directionLabel, selected && styles.directionLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function Instruction({
  body,
  icon,
  label,
  onCopy,
  title,
  value,
}: {
  body?: string;
  icon: React.ReactNode;
  label: string;
  onCopy?: () => void;
  title?: string;
  value?: string;
}) {
  return (
    <View style={styles.instructionRow}>
      {icon}
      <View style={styles.instructionCopy}>
        <Text style={styles.instructionLabel}>{label}</Text>
        {title ? <Text style={styles.instructionValue}>{title}</Text> : null}
        {value ? (
          <Pressable accessibilityRole="button" onPress={onCopy} style={styles.copyRow}>
            <Text style={styles.mono}>{value}</Text>
            {onCopy ? <Copy color={colors.inkMuted} size={14} /> : null}
          </Pressable>
        ) : null}
        {body ? <Text style={styles.body}>{body}</Text> : null}
      </View>
    </View>
  );
}

/** The anchor's own state names, said the way a person would say them. */
function readableStatus(status: string | undefined, direction: Direction): string {
  switch (status) {
    case 'pending_user_transfer_start':
      return 'Waiting for your bank transfer';
    case 'pending_anchor':
      return direction === 'add'
        ? 'The anchor has your lira and is converting it'
        : 'The anchor has your USDC and is paying the lira out';
    case 'pending_stellar':
      return 'Sending the USDC to your wallet';
    case 'completed':
      return 'Done';
    case 'error':
      return 'The anchor could not finish this transfer';
    default:
      return status ?? 'Starting';
  }
}

const styles = StyleSheet.create({
  hero: {gap: spacing.xs},
  icon: {alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.goldDeep, borderRadius: radius.round, borderWidth: 1, height: 44, justifyContent: 'center', marginBottom: spacing.sm, width: 44},
  eyebrow: {...typography.label, color: colors.goldBright},
  title: {...typography.display, color: colors.ink, fontSize: 28, lineHeight: 34},
  subtitle: {...typography.body, color: colors.inkMuted},
  directionRow: {flexDirection: 'row', gap: spacing.xs},
  directionPill: {borderColor: colors.lineSoft, borderRadius: radius.round, borderWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm},
  directionPillSelected: {backgroundColor: colors.goldSoft, borderColor: colors.goldDeep},
  directionLabel: {...typography.body, color: colors.inkMuted},
  directionLabelSelected: {color: colors.goldBright},
  form: {gap: spacing.lg},
  receipt: {backgroundColor: colors.surface, borderColor: colors.lineSoft, borderRadius: radius.xl, borderWidth: 1, gap: spacing.lg, padding: spacing.lg},
  counter: {backgroundColor: colors.surface, borderColor: colors.lineSoft, borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden'},
  side: {gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg},
  sideLabel: {...typography.overline, color: colors.inkFaint},
  sideRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  mark: {color: colors.inkMuted, fontSize: 26, fontWeight: '600'},
  flag: {fontSize: 26},
  sideInput: {color: colors.ink, flex: 1, fontSize: 30, fontWeight: '700', padding: 0},
  receive: {color: colors.goldBright, flex: 1, fontSize: 30, fontWeight: '700'},
  sideUnit: {...typography.mono, color: colors.inkFaint, fontSize: 13},
  held: {...typography.body, color: colors.inkFaint, fontSize: 13},
  heldWarning: {color: colors.danger},
  divider: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg},
  dividerLine: {backgroundColor: colors.lineSoft, flex: 1, height: 1},
  dividerMark: {alignItems: 'center', backgroundColor: colors.goldSoft, borderRadius: 999, height: 30, justifyContent: 'center', width: 30},
  terms: {...typography.body, color: colors.inkMuted, fontSize: 14, textAlign: 'center'},
  rate: {...typography.body, color: colors.inkMuted},
  rateWarning: {color: colors.danger},
  instructionRow: {flexDirection: 'row', gap: spacing.md},
  instructionCopy: {flex: 1, gap: spacing.xs},
  instructionLabel: {...typography.label, color: colors.inkMuted},
  instructionValue: {...typography.body, color: colors.ink},
  copyRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs},
  mono: {...typography.mono, color: colors.ink, fontSize: 13},
  body: {...typography.body, color: colors.inkFaint, fontSize: 13},
  separator: {backgroundColor: colors.lineSoft, height: 1},
  status: {gap: spacing.xs},
  statusValue: {...typography.body, color: colors.ink},
  received: {...typography.body, color: colors.success},
  error: {...typography.body, color: colors.danger},
});
