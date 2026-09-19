import {History, ReceiptText, SlidersHorizontal} from 'lucide-react-native';
import {useState} from 'react';
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {AnimatedList, colors, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import {Screen} from '../../shared/Screen';
import {displayAmount} from '../../shared/displayAmount';
import {useAppStore} from '../../state/appStore';

type ActivityFilter = 'all' | 'settled' | 'demo';

export function ActivityScreen() {
  const receipts = useAppStore(state => state.receipts);
  const {width} = useWindowDimensions();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const visible =
    filter === 'all'
      ? receipts
      : filter === 'settled'
        ? receipts.filter(receipt => receipt.status === 'confirmed')
        : [];
  // The summary follows the filter, so the number always matches the list.
  const totalPaid = displayAmount(visible.reduce((sum, receipt) => sum + Number(receipt.amount), 0));
  return (
    <Screen>
      <View style={styles.header}><View><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.title}>Activity</Text></View><Pressable
        accessibilityLabel="Filter activity"
        onPress={() => setFilter(current => (current === 'all' ? 'settled' : current === 'settled' ? 'demo' : 'all'))}
        style={styles.filter}
        testID="cycle-activity-filter">
        <SlidersHorizontal color={colors.amber} size={18} />
      </Pressable></View>
      <View style={styles.summary}><View><Text style={styles.summaryLabel}>{filter === 'all' ? 'TOTAL PAID' : filter === 'settled' ? 'PAID ON-CHAIN' : 'DEMO TOTAL'}</Text><Text style={styles.summaryValue}>{totalPaid} <Text style={styles.summaryAsset}>XLM</Text></Text></View><View style={styles.summaryDivider} /><View><Text style={styles.summaryLabel}>PAYMENTS</Text><Text style={styles.summaryValue}>{visible.length}</Text></View></View>
      <View style={styles.filters}>
        {(['all', 'settled', 'demo'] as const).map(option => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{selected: option === filter}}
            key={option}
            onPress={() => setFilter(option)}
            style={[styles.filterOption, option === filter && styles.filterActive]}
            testID={`activity-filter-${option}`}>
            <Text style={option === filter ? styles.filterActiveText : styles.filterText}>
              {option === 'all' ? 'All activity' : option === 'settled' ? 'On-chain' : 'Demo'}
            </Text>
          </Pressable>
        ))}
      </View>
      {visible.length === 0 ? (
        <SurfaceCard style={styles.empty}>
          <View style={styles.emptyIcon}><History color={colors.amber} size={24} /></View><Text style={styles.emptyTitle}>{receipts.length === 0 ? 'No activity yet' : 'Nothing in this filter'}</Text><Text style={styles.body}>{receipts.length === 0 ? 'Your confirmed payments and receipts will appear here.' : 'Switch the filter to see your other payments.'}</Text>
        </SurfaceCard>
      ) : (
        <AnimatedList style={styles.list}>{visible.map(receipt => (
        <SurfaceCard key={receipt.intentId} padded={false} style={styles.item}><View style={[styles.itemInner, width < 380 && styles.itemInnerCompact]}><View style={styles.paymentIcon}><ReceiptText color={colors.success} size={17} /></View><View style={styles.copy}><Text style={styles.itemTitle}>{receipt.merchantName}</Text><Text style={styles.body}>{'Payment · Stellar Testnet'}</Text><Text style={styles.time}>{new Date(receipt.createdAt).toLocaleDateString()}</Text></View><View style={styles.amountBlock}><Text numberOfLines={1} style={styles.amount}>-{displayAmount(receipt.amount)}</Text><Text style={styles.asset}>{receipt.assetCode}</Text><StatusPill tone="success">CONFIRMED</StatusPill></View></View></SurfaceCard>
        ))}</AnimatedList>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.2},
  title: {...typography.title, color: colors.ink, fontSize: 26, marginTop: 2},
  filter: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderColor: colors.line, borderRadius: radius.round, borderWidth: 1, height: 38, justifyContent: 'center', width: 38},
  summary: {alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-around', padding: spacing.lg},
  summaryLabel: {...typography.label, color: colors.inkMuted, fontSize: 10, letterSpacing: 0.9},
  summaryCaption: {color: colors.inkMuted, fontSize: 11},
  summaryValue: {color: colors.ink, fontSize: 23, fontWeight: '700', marginTop: spacing.xs},
  summaryAsset: {color: colors.amber, fontSize: 13},
  summaryDivider: {backgroundColor: colors.line, height: 38, width: 1},
  filters: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, padding: spacing.xs},
  filterOption: {borderRadius: radius.sm, flex: 1, paddingHorizontal: spacing.sm, paddingVertical: 9},
  filterActive: {backgroundColor: colors.amberSoft},
  filterActiveText: {...typography.label, color: colors.amber, fontSize: 12, textAlign: 'center'},
  filterText: {...typography.label, color: colors.inkMuted, flex: 1, fontSize: 12, textAlign: 'center'},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl},
  list: {gap: spacing.md},
  emptyIcon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 48, justifyContent: 'center', width: 48},
  emptyTitle: {...typography.title, color: colors.ink, fontSize: 16},
  body: {color: colors.inkMuted, fontSize: 12, lineHeight: 17, textAlign: 'center'},
  item: {marginBottom: spacing.sm},
  itemInner: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  itemInnerCompact: {alignItems: 'flex-start', flexWrap: 'wrap'},
  paymentIcon: {alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.round, height: 38, justifyContent: 'center', width: 38},
  copy: {flex: 1, gap: 2},
  itemTitle: {...typography.label, color: colors.ink, fontSize: 14},
  time: {color: colors.inkMuted, fontSize: 11, marginTop: spacing.xs},
  amountBlock: {alignItems: 'flex-end', gap: spacing.xs},
  amount: {color: colors.ink, fontSize: 15, fontWeight: '700'},
  asset: {color: colors.amber, fontSize: 11},
});
