import {Filter, History, SlidersHorizontal} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import {Screen} from '../../shared/Screen';
import {useAppStore} from '../../state/appStore';

export function ActivityScreen() {
  const receipts = useAppStore(state => state.receipts);
  return (
    <Screen>
      <View style={styles.header}><View><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.title}>Activity</Text></View><Pressable accessibilityLabel="Filter activity" style={styles.filter}><SlidersHorizontal color={colors.amber} size={18} /></Pressable></View>
      <View style={styles.summary}><View><Text style={styles.summaryLabel}>THIS MONTH</Text><Text style={styles.summaryValue}>{receipts[0]?.amount ?? '0.00'} <Text style={styles.summaryAsset}>XLM</Text></Text></View><View style={styles.summaryDivider} /><View><Text style={styles.summaryLabel}>PAYMENTS</Text><Text style={styles.summaryValue}>{receipts.length}</Text></View></View>
      <View style={styles.filters}><View style={styles.filterActive}><Text style={styles.filterActiveText}>All activity</Text></View><Text style={styles.filterText}>Payments</Text><Text style={styles.filterText}>Received</Text></View>
      {receipts.length === 0 ? (
        <SurfaceCard style={styles.empty}>
          <View style={styles.emptyIcon}><History color={colors.amber} size={24} /></View><Text style={styles.emptyTitle}>No activity yet</Text><Text style={styles.body}>Your confirmed payments and receipts will appear here.</Text>
        </SurfaceCard>
      ) : receipts.map(receipt => (
        <SurfaceCard key={receipt.intentId} padded={false} style={styles.item}><View style={styles.itemInner}><View style={styles.paymentIcon}><Filter color={colors.success} size={17} /></View><View style={styles.copy}><Text style={styles.itemTitle}>{receipt.merchantName}</Text><Text style={styles.body}>Payment · Stellar Testnet</Text><Text style={styles.time}>{new Date(receipt.createdAt).toLocaleDateString()}</Text></View><View style={styles.amountBlock}><Text style={styles.amount}>-{receipt.amount}</Text><Text style={styles.asset}>{receipt.assetCode}</Text><StatusPill tone="success">CONFIRMED</StatusPill></View></View></SurfaceCard>
      ))}
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
  summaryValue: {color: colors.ink, fontSize: 23, fontWeight: '700', marginTop: spacing.xs},
  summaryAsset: {color: colors.amber, fontSize: 13},
  summaryDivider: {backgroundColor: colors.line, height: 38, width: 1},
  filters: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, padding: spacing.xs},
  filterActive: {backgroundColor: colors.amberSoft, borderRadius: radius.sm, flex: 1, paddingHorizontal: spacing.sm, paddingVertical: 9},
  filterActiveText: {...typography.label, color: colors.amber, fontSize: 12, textAlign: 'center'},
  filterText: {...typography.label, color: colors.inkMuted, flex: 1, fontSize: 12, textAlign: 'center'},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl},
  emptyIcon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 48, justifyContent: 'center', width: 48},
  emptyTitle: {...typography.title, color: colors.ink, fontSize: 16},
  body: {color: colors.inkMuted, fontSize: 12, lineHeight: 17, textAlign: 'center'},
  item: {marginBottom: spacing.sm},
  itemInner: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  paymentIcon: {alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.round, height: 38, justifyContent: 'center', width: 38},
  copy: {flex: 1, gap: 2},
  itemTitle: {...typography.label, color: colors.ink, fontSize: 14},
  time: {color: colors.inkMuted, fontSize: 11, marginTop: spacing.xs},
  amountBlock: {alignItems: 'flex-end', gap: spacing.xs},
  amount: {color: colors.ink, fontSize: 15, fontWeight: '700'},
  asset: {color: colors.amber, fontSize: 11},
});
