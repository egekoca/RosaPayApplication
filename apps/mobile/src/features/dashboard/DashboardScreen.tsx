import {ArrowDownLeft, ArrowUpRight, BarChart3, Radio, ScanLine, WalletCards} from 'lucide-react-native';
import type {ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, colors, radius, spacing, SurfaceCard, typography} from '@rosapay/ui';
import {Screen} from '../../shared/Screen';
import {displayAmount} from '../../shared/displayAmount';
import {useTranslate} from '../../shared/i18n';
import {useAppStore, type PaymentTransport} from '../../state/appStore';
import {useMerchantPayments} from '../merchant/merchantRequestStatus';

/**
 * A small, honest overview of activity recorded by this wallet.
 *
 * The transport is attached when a payment is scanned or taken off the radio
 * on this device. The
 * merchant API does not currently persist transport metadata, so channel cards
 * deliberately use local confirmed receipts while the merchant total uses the
 * server's confirmed payment list when available.
 */
export function DashboardScreen() {
  const t = useTranslate();
  const receipts = useAppStore(state => state.receipts);
  const ramps = useAppStore(state => state.rampActivities);
  const merchantProfile = useAppStore(state => state.merchantProfile);
  const payments = useMerchantPayments(merchantProfile?.merchantProfileId);

  const confirmedReceipts = receipts.filter(receipt => receipt.status === 'confirmed');
  const qrTotal = totalForTransport(confirmedReceipts, 'qr');
  // Bluetooth now, NFC in receipts kept from before it was taken out. To
  // whoever paid, both were holding the phones together, and which radio
  // carried the bytes was never something they saw.
  const tapTotal = sumAmounts([
    totalForTransport(confirmedReceipts, 'nfc'),
    totalForTransport(confirmedReceipts, 'ble'),
  ]);
  const localTotal = sumAmounts(confirmedReceipts.map(receipt => receipt.amount));
  const serverTotal = payments.data?.payments
    .filter(payment => payment.status === 'confirmed')
    .map(payment => payment.amount)
    .reduce(addDecimal, '0');
  const total = serverTotal ?? localTotal;
  const deposits = ramps.filter(activity => activity.kind === 'deposit');
  const withdrawals = ramps.filter(activity => activity.kind === 'withdrawal');

  return (
    <Screen>
      <AnimatedContent>
        <View style={styles.heading}>
          <View style={styles.headingIcon}><BarChart3 color={colors.goldBright} size={22} /></View>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>{t('OVERVIEW')}</Text>
            <Text style={styles.title}>{t('Dashboard')}</Text>
          </View>
        </View>
      </AnimatedContent>

      <AnimatedContent delay={70}>
        <SurfaceCard style={styles.totalCard}>
          <View style={styles.totalHeader}>
            <View style={styles.totalIcon}><ArrowDownLeft color={colors.success} size={20} /></View>
            <Text style={styles.cardLabel}>{t(serverTotal !== undefined ? 'TOTAL RECEIVED' : 'TOTAL PAYMENTS')}</Text>
          </View>
          <Text adjustsFontSizeToFit numberOfLines={1} style={styles.totalValue}>{displayAmount(total)}</Text>
          <Text style={styles.totalHint}>{serverTotal !== undefined ? t('Confirmed merchant payments') : t('Confirmed payments on this phone')}</Text>
        </SurfaceCard>
      </AnimatedContent>

      <AnimatedContent delay={120}>
        <Text style={styles.sectionLabel}>{t('PAYMENT CHANNELS')}</Text>
        <View style={styles.grid}>
          <MetricCard icon={<ScanLine color={colors.goldBright} size={19} />} label={t('QR RECEIVED')} value={qrTotal} confirmedLabel={t('confirmed')} />
          <MetricCard icon={<Radio color={colors.goldBright} size={19} />} label={t('HELD TOGETHER')} value={tapTotal} confirmedLabel={t('confirmed')} />
        </View>
      </AnimatedContent>

      <AnimatedContent delay={170}>
        <Text style={styles.sectionLabel}>{t('MONEY MOVEMENT')}</Text>
        <View style={styles.movement}>
          <MovementRow
            icon={<ArrowDownLeft color={colors.success} size={18} />}
            label={t('Money deposited')}
            count={deposits.length}
            amount={sumAmounts(deposits.map(activity => activity.amount))}
            asset="TRY"
            transferLabel={t('transfers')}
          />
          <View style={styles.rowDivider} />
          <MovementRow
            icon={<ArrowUpRight color={colors.amber} size={18} />}
            label={t('Money withdrawn')}
            count={withdrawals.length}
            amount={sumAmounts(withdrawals.map(activity => activity.amount))}
            asset="USDC"
            transferLabel={t('transfers')}
          />
        </View>
      </AnimatedContent>

      <AnimatedContent delay={220}>
        <View style={styles.noteRow}>
          <WalletCards color={colors.inkFaint} size={16} />
          <Text style={styles.note}>{t('Channel totals reflect confirmed activity saved on this device.')}</Text>
        </View>
      </AnimatedContent>
    </Screen>
  );
}

export function totalForTransport(receipts: Array<{amount: string; transport?: PaymentTransport}>, transport: PaymentTransport): string {
  return sumAmounts(receipts.filter(receipt => receipt.transport === transport).map(receipt => receipt.amount));
}

export function sumAmounts(amounts: string[]): string {
  return amounts.reduce(addDecimal, '0');
}

/** Adds decimal token amounts as strings, preserving seven Stellar places. */
function addDecimal(left: string, right: string): string {
  const [leftWhole = '0', leftFraction = ''] = left.split('.');
  const [rightWhole = '0', rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const fraction = addDigitStrings(leftFraction.padEnd(scale, '0'), rightFraction.padEnd(scale, '0'));
  const whole = addDigitStrings(leftWhole, rightWhole);
  const carry = fraction.length > scale ? 1 : 0;
  const normalizedFraction = scale === 0 ? '' : fraction.slice(-scale).padStart(scale, '0');
  const normalizedWhole = addDigitStrings(whole, String(carry));
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}`.replace(/\.0+$/, '') : normalizedWhole;
}

function addDigitStrings(left: string, right: string): string {
  let carry = 0;
  let result = '';
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const a = Number(left[left.length - 1 - index] ?? '0');
    const b = Number(right[right.length - 1 - index] ?? '0');
    const sum = a + b + carry;
    result = String(sum % 10) + result;
    carry = Math.floor(sum / 10);
  }
  return (carry ? String(carry) : '') + (result || '0');
}

function MetricCard({icon, label, value, confirmedLabel}: {icon: ReactNode; label: string; value: string; confirmedLabel: string}) {
  return (
    <SurfaceCard style={styles.metric}>
      <View style={styles.metricIcon}>{icon}</View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{displayAmount(value)}</Text>
      <Text style={styles.metricAsset}>{confirmedLabel}</Text>
    </SurfaceCard>
  );
}

function MovementRow({icon, label, count, amount, asset, transferLabel}: {icon: ReactNode; label: string; count: number; amount: string; asset: string; transferLabel: string}) {
  return (
    <View style={styles.movementRow}>
      <View style={styles.movementIcon}>{icon}</View>
      <View style={styles.movementCopy}>
        <Text style={styles.movementLabel}>{label}</Text>
        <Text style={styles.movementCount}>{count} {transferLabel}</Text>
      </View>
      <Text style={styles.movementAmount}>{displayAmount(amount)} <Text style={styles.movementAsset}>{asset}</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  headingIcon: {alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.goldDeep, borderRadius: radius.round, borderWidth: 1, height: 46, justifyContent: 'center', width: 46},
  headingCopy: {gap: 2},
  eyebrow: {...typography.label, color: colors.goldBright, fontSize: 10, letterSpacing: 1.1},
  title: {...typography.title, color: colors.ink, fontSize: 27},
  totalCard: {gap: spacing.sm, padding: spacing.xl},
  totalHeader: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  totalIcon: {alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.round, height: 34, justifyContent: 'center', width: 34},
  cardLabel: {...typography.label, color: colors.inkMuted, fontSize: 11},
  totalValue: {color: colors.ink, fontSize: 37, fontWeight: '700'},
  totalHint: {...typography.body, color: colors.inkMuted, fontSize: 12},
  sectionLabel: {...typography.overline, color: colors.inkFaint, marginTop: spacing.md},
  grid: {flexDirection: 'row', gap: spacing.sm},
  metric: {flex: 1, gap: spacing.xs, minHeight: 130, padding: spacing.md},
  metricIcon: {alignItems: 'center', backgroundColor: colors.goldSoft, borderRadius: radius.round, height: 32, justifyContent: 'center', width: 32},
  metricLabel: {...typography.label, color: colors.inkMuted, fontSize: 10, marginTop: spacing.xs},
  metricValue: {color: colors.ink, fontSize: 22, fontWeight: '700'},
  metricAsset: {color: colors.inkFaint, fontSize: 11},
  movement: {backgroundColor: colors.surface, borderColor: colors.lineSoft, borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg},
  movementRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 68},
  movementIcon: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.round, height: 34, justifyContent: 'center', width: 34},
  movementCopy: {flex: 1, gap: 2},
  movementLabel: {...typography.body, color: colors.ink, fontSize: 15},
  movementCount: {color: colors.inkFaint, fontSize: 11},
  movementAmount: {color: colors.ink, fontSize: 15, fontWeight: '700'},
  movementAsset: {color: colors.goldBright, fontSize: 11},
  rowDivider: {backgroundColor: colors.lineSoft, height: 1},
  noteRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg},
  note: {color: colors.inkFaint, flex: 1, fontSize: 11, lineHeight: 16},
});
