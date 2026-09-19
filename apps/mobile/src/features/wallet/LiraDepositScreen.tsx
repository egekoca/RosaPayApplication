import {useCallback, useEffect, useRef, useState} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Banknote, Building2, Copy, Landmark, ShieldCheck} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, radius, spacing, SurfaceCard, TextField, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {displayAmount} from '../../shared/displayAmount';
import {shareValue} from '../../shared/shareAddress';
import {useWalletBalance} from '../../shared/useWalletBalance';
import {useCurrentAccount} from './currentAccount';
import {
  LIRA_ANCHOR_HOME_DOMAIN,
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

  useEffect(() => () => clearInterval(polling.current), []);

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
            <Text style={styles.title}>Lira needs a recovery-phrase wallet</Text>
            <Text style={styles.subtitle}>
              The anchor verifies a wallet by having it sign a challenge, which only an ordinary Stellar account can
              do. This phone's wallet lives in its secure hardware and has no key that can answer. Set this phone up
              again with a recovery phrase to move money in lira.
            </Text>
          </View>
        </AnimatedContent>
        <AnimatedContent delay={90}>
          <Button onPress={() => navigation.goBack()}>Go back</Button>
        </AnimatedContent>
      </Screen>
    );
  }

  return (
    <Screen>
      <AnimatedContent>
        <View style={styles.hero}>
          <View style={styles.icon}><Banknote color={colors.amber} size={22} /></View>
          <Text style={styles.eyebrow}>{direction === 'add' ? 'ADD MONEY' : 'CASH OUT'}</Text>
          <Text style={styles.title}>{direction === 'add' ? 'Pay in lira' : 'Take out lira'}</Text>
          <Text style={styles.subtitle}>
            {direction === 'add'
              ? 'Send a bank transfer in Turkish lira and receive USDC in this wallet.'
              : 'Send USDC from this wallet and receive Turkish lira in your bank account.'}{' '}
            Rate and fee come from {LIRA_ANCHOR_HOME_DOMAIN}.
          </Text>
        </View>
      </AnimatedContent>

      {!open ? (
        <>
          <AnimatedContent delay={60}>
            <View style={styles.directionRow}>
              <DirectionPill
                label="Add money"
                onPress={() => {
                  setDirection('add');
                  setAmount('500');
                }}
                selected={direction === 'add'}
                testID="direction-add"
              />
              <DirectionPill
                label="Cash out"
                onPress={() => {
                  setDirection('cash-out');
                  setAmount(usdcHeld === '0' ? '' : usdcHeld);
                }}
                selected={direction === 'cash-out'}
                testID="direction-cash-out"
              />
            </View>
          </AnimatedContent>

          <AnimatedContent delay={80} scaleFrom={0.985}>
            <SurfaceCard accent="amber" style={styles.form}>
              <TextField
                keyboardType="decimal-pad"
                label={`AMOUNT (${unit})`}
                maxLength={14}
                onChangeText={setAmount}
                placeholder={direction === 'add' ? '500' : '10'}
                testID="lira-amount"
                value={amount}
              />
              {direction === 'cash-out' ? (
                <Text style={styles.rate}>You hold {displayAmount(usdcHeld)} USDC</Text>
              ) : null}
              {direction === 'add' && quote ? (
                <Text style={styles.rate} testID="lira-quote">
                  You receive {displayAmount(quote.buyAmount)} USDC · {displayAmount(quote.perUsdc)} TRY per USDC
                  {quote.feeTotal ? ` · fee ${displayAmount(quote.feeTotal)} TRY` : ''}
                </Text>
              ) : null}
              {direction === 'cash-out' && payout ? (
                <Text style={styles.rate} testID="lira-payout">
                  You receive {displayAmount(payout.buyAmount)} TRY · {displayAmount(payout.perUsdc)} TRY per USDC
                  {payout.feeTotal ? ` · fee ${displayAmount(payout.feeTotal)} TRY` : ''}
                </Text>
              ) : null}
              {(direction === 'add' && !quote) || (direction === 'cash-out' && !payout) ? (
                <Text style={styles.rate}>Reading the anchor's rate…</Text>
              ) : null}
            </SurfaceCard>
          </AnimatedContent>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <AnimatedContent delay={160}>
            <Button loading={busy} onPress={() => void begin()} testID="open-lira-transfer">
              {direction === 'add' ? 'Continue' : 'Send and cash out'}
            </Button>
          </AnimatedContent>
        </>
      ) : (
        <>
          <AnimatedContent delay={80} scaleFrom={0.985}>
            <SurfaceCard accent="amber" style={styles.form}>
              {started ? (
                <>
                  <Instruction
                    icon={<Building2 color={colors.goldBright} size={18} />}
                    label="SEND TO"
                    onCopy={() => void shareValue('Anchor IBAN', started.instructions.iban ?? '')}
                    title={started.instructions.bankName ?? 'The anchor’s bank'}
                    {...(started.instructions.iban ? {value: started.instructions.iban} : {})}
                  />
                  <View style={styles.separator} />
                  <Instruction
                    body="Write this in the transfer description. It is what routes the money to your wallet."
                    icon={<ShieldCheck color={colors.success} size={18} />}
                    label="REFERENCE (AÇIKLAMA)"
                    onCopy={() => void shareValue('Transfer reference', started.instructions.reference ?? '')}
                    {...(started.instructions.reference ? {value: started.instructions.reference} : {})}
                  />
                </>
              ) : withdrawal ? (
                <Instruction
                  body={`${displayAmount(withdrawal.amountUsdc)} USDC has been sent to the anchor. It pays the lira out once it sees the payment.`}
                  icon={<Landmark color={colors.goldBright} size={18} />}
                  label="PAID OUT TO"
                  {...(withdrawal.bankAccount
                    ? {value: withdrawal.bankAccount}
                    : {title: 'Your registered bank account'})}
                />
              ) : null}
            </SurfaceCard>
          </AnimatedContent>

          <AnimatedContent delay={150}>
            <View style={styles.status}>
              <Text style={styles.instructionLabel}>STATUS</Text>
              <Text style={styles.statusValue} testID="lira-status">
                {readableStatus(status, direction)}
              </Text>
              {received ? (
                <Text style={styles.received} testID="lira-received">
                  {displayAmount(received)} {direction === 'add' ? 'USDC arrived in this wallet.' : 'TRY was paid out.'}
                </Text>
              ) : null}
            </View>
          </AnimatedContent>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {started && status === 'pending_user_transfer_start' ? (
            <AnimatedContent delay={210}>
              {/*
                A sandbox affordance, named for what it is. There is no real bank
                behind this anchor, so nothing else would ever move the money.
              */}
              <Button loading={busy} onPress={() => void simulate()} testID="simulate-bank-transfer">
                Simulate the bank transfer
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
  rate: {...typography.body, color: colors.inkMuted},
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
