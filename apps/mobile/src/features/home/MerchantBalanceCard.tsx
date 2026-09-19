import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {Store} from 'lucide-react-native';
import {CountUp, GoldCardSurface, LoadingDots, spacing, typography} from '@rosapay/ui';
import {useTranslate} from '../../shared/i18n';

type MerchantBalanceCardProps = {
  displayName: string;
  /** What this business has been paid, which is not what the wallet holds. */
  total: number;
  /** The wallet's own balance — the same money the Pay view shows. */
  balance?: string;
  balanceCurrency?: {amount: string; currency: string};
  requestCount: number;
  settledCount: number;
  loading?: boolean;
  error?: boolean;
};

const CARD_RATIO = 53.98 / 85.6;
const ink = '#1C1503';
const inkSoft = 'rgba(28,21,3,0.62)';

/**
 * The business view of the one wallet this phone has.
 *
 * It used to lead with takings, in the same gold card and the same big number
 * the Pay view uses for the balance. Switching to Get paid therefore appeared
 * to empty the wallet, and the two views read as two accounts — which is the
 * one thing this app is built not to be. So the headline is the balance, the
 * same figure as the other side of the switch, and takings sit beneath it
 * labelled as takings.
 */
export function MerchantBalanceCard({
  displayName,
  total,
  balance,
  balanceCurrency,
  requestCount,
  settledCount,
  loading = false,
  error = false,
}: MerchantBalanceCardProps) {
  const t = useTranslate();
  const {width} = useWindowDimensions();
  const cardWidth = Math.min(width - spacing.xl * 2 - 14, 500);
  const cardHeight = Math.round(cardWidth * CARD_RATIO);
  const statusLabel = error ? 'LOCAL VIEW' : loading ? 'SYNCING' : 'LIVE';

  return (
    <GoldCardSurface
      animated
      contentStyle={styles.content}
      height={cardHeight}
      idSuffix="merchant"
      interactive
      width={cardWidth}>
      <View style={styles.top}>
        <Store color={inkSoft} size={18} strokeWidth={1.8} />
      </View>

      <View style={styles.middle}>
        <View style={styles.status}>
          <View style={[styles.statusDot, error && styles.statusDotError]} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        <View style={styles.amountRow}>
          <CountUp value={Number(balance ?? 0)} decimals={2} duration={620} style={styles.amount} />
          <Text style={styles.asset}>XLM</Text>
        </View>
        <Text style={styles.legendLabel}>
          {balanceCurrency ? `BALANCE  ≈ ${balanceCurrency.amount} ${balanceCurrency.currency}` : 'BALANCE'}
        </Text>
      </View>

      <View style={styles.bottom}>
        <View style={styles.legend}>
          <Text style={styles.legendLabel}>{t('BUSINESS')}</Text>
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.business}>
            {displayName.toUpperCase()}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>
            {total.toFixed(2)} XLM
          </Text>
          <Text style={styles.legendLabel}>TAKEN · {settledCount}/{requestCount}</Text>
        </View>
      </View>
      {loading ? <LoadingDots color={inkSoft} size={4} style={styles.loading} /> : null}
    </GoldCardSurface>
  );
}

const styles = StyleSheet.create({
  content: {flex: 1, justifyContent: 'space-between'},
  top: {alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between'},
  brand: {...typography.mono, color: ink, fontSize: 9.5, letterSpacing: 2.4},
  middle: {gap: spacing.xs},
  status: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs},
  statusDot: {backgroundColor: ink, borderRadius: 999, height: 6, width: 6},
  statusDotError: {backgroundColor: '#6B3E08'},
  statusText: {...typography.mono, color: inkSoft, fontSize: 8.5, letterSpacing: 1.4},
  amountRow: {alignItems: 'baseline', flexDirection: 'row', gap: spacing.sm},
  amount: {...typography.display, color: ink, fontSize: 38, lineHeight: 42},
  asset: {...typography.mono, color: inkSoft, fontSize: 12, letterSpacing: 1.4},
  bottom: {alignItems: 'flex-end', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between'},
  legend: {flex: 1, gap: 2},
  legendLabel: {...typography.mono, color: inkSoft, fontSize: 7.5, letterSpacing: 1.8},
  business: {...typography.mono, color: ink, fontSize: 9.5, letterSpacing: 1.1},
  metric: {alignItems: 'flex-end', gap: 2},
  metricValue: {...typography.mono, color: ink, fontSize: 12, letterSpacing: 1.2},
  loading: {alignSelf: 'flex-end', height: 10, position: 'absolute', right: 0, top: '48%'},
});
