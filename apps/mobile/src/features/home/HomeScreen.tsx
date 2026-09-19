import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {CompositeScreenProps} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ArrowUpRight, ChevronRight, Copy, QrCode, ScanLine, ShieldCheck, SlidersHorizontal, Store, TrendingUp} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import type {ReactNode} from 'react';
import {AnimatedContent, Button, colors, CountUp, PressScale, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import type {MainTabsParams, RootStackParams} from '../../app/navigation';
import {ModeSwitcher} from '../../shared/ModeSwitcher';
import {LumenadeMark} from '../../shared/LumenadeMark';
import {useMerchantPayments} from '../merchant/merchantRequestStatus';
import {Screen} from '../../shared/Screen';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useWalletBalance} from '../../shared/useWalletBalance';
import {shareValue} from '../../shared/shareAddress';
import {useAppStore} from '../../state/appStore';
import {greetingFor} from './greeting';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabsParams, 'Home'>,
  NativeStackScreenProps<RootStackParams>
>;

export function HomeScreen({navigation}: Props) {
  const {width} = useWindowDimensions();
  const {mode, merchantProfile, settlementMode, account} = useAppStore();
  const merchantEnabled = merchantProfile !== null;
  const stellarHealth = useStellarHealth();
  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.identity}>
          <LumenadeMark motion="float" size={38} />
          <View><Text style={styles.eyebrow}>LUMENADE PAY</Text><Text style={styles.greeting} numberOfLines={1}>{greetingFor(account?.name)}</Text></View>
        </View>
        <Pressable accessibilityLabel="Developer settings" onPress={() => navigation.navigate('DeveloperSettings')} style={styles.iconButton} testID="open-developer-settings"><SlidersHorizontal color={colors.inkMuted} size={19} /></Pressable>
      </View>
      <View style={styles.networkRow}><View style={styles.network}><View style={[styles.dot, stellarHealth.isError && styles.dotError]} /><Text style={styles.networkText}>{stellarHealth.isPending ? 'Checking Testnet' : stellarHealth.isError ? 'Testnet unavailable' : 'Stellar Testnet'}</Text><ChevronRight color={colors.inkMuted} size={15} /></View><StatusPill tone={settlementMode === 'testnet' ? 'success' : 'pending'}>{settlementMode === 'testnet' ? 'TESTNET' : 'DEMO MODE'}</StatusPill></View>
      <ModeSwitcher />
      {mode === 'customer' ? (
        <CustomerHome navigation={navigation} merchantEnabled={merchantEnabled} isNarrow={width < 360} />
      ) : (
        <MerchantHome navigation={navigation} recipient={merchantProfile?.recipient} />
      )}
    </Screen>
  );
}

function CustomerHome({navigation, merchantEnabled, isNarrow}: {navigation: Props['navigation']; merchantEnabled: boolean; isNarrow: boolean}) {
  const smartWallet = useAppStore(state => state.smartWallet);
  const balance = useWalletBalance();
  const address = smartWallet?.contractId;

  return (
    <>
      <AnimatedContent><SurfaceCard accent="amber" style={styles.balanceCard}>
        <View style={styles.cardHeader}><Text style={styles.cardLabel}>TOTAL BALANCE</Text><View style={styles.balanceNetwork}><View style={[styles.dot, balance.isError && styles.dotError]} /><Text style={styles.balanceNetworkText}>XLM</Text></View></View>
        <View style={styles.balanceLine}><CountUp value={Number(balance.data ?? 0)} decimals={2} style={styles.balance} /><Text style={styles.balanceAsset}>XLM</Text></View>
        <Text style={styles.balanceValue}>
          {!smartWallet
            ? 'Your wallet is created the first time you pay on Testnet.'
            : balance.isPending
              ? 'Reading your balance from Stellar'
              : balance.isError
                ? 'Stellar could not be reached, so this balance may be stale.'
                : 'Held by your device wallet on Stellar Testnet'}
        </Text>
        <View style={styles.addressRow}>
          <Text selectable style={styles.address}>{address ? `${address.slice(0, 8)}...${address.slice(-6)}` : 'No wallet yet'}</Text>
          <Pressable
            accessibilityLabel="Share wallet address"
            disabled={!address}
            onPress={() => address && void shareValue('My Lumenade Pay wallet', address)}
            testID="share-wallet-address">
            <Copy color={address ? colors.amber : colors.inkMuted} size={16} />
          </Pressable>
        </View>
      </SurfaceCard></AnimatedContent>
      <View style={[styles.quickGrid, isNarrow && styles.quickGridStacked]}>
        <QuickAction stacked={isNarrow} icon={<ScanLine color={colors.amber} size={22} />} title="Scan to pay" hint="Use a merchant QR" onPress={() => navigation.navigate('Scan')} />
        <QuickAction stacked={isNarrow} disabled icon={<ArrowUpRight color={colors.inkMuted} size={22} />} title="Send" hint="Coming soon" />
      </View>
      <SectionTitle title="Recent activity" action="View all" onAction={() => navigation.navigate('Activity')} />
      <SurfaceCard padded={false} style={styles.activityCard}>
        <View style={styles.activityRow}><View style={styles.activityIcon}><TrendingUp color={colors.success} size={18} /></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>No payments yet</Text><Text style={styles.activityHint}>Your confirmed payments will appear here.</Text></View><ChevronRight color={colors.inkMuted} size={17} /></View>
      </SurfaceCard>
      {!merchantEnabled && (
        <SurfaceCard accent="amber" style={styles.capabilityCard}>
          <View style={styles.capabilityIcon}><Store color={colors.lemon} size={20} /></View>
          <View style={styles.capabilityCopy}><Text style={styles.capabilityTitle}>Accept payments</Text><Text style={styles.capabilityBody}>Add merchant tools to this account.</Text></View>
          <Button tone="ghost" onPress={() => navigation.navigate('MerchantOnboarding')}>Activate</Button>
        </SurfaceCard>
      )}
    </>
  );
}

function MerchantHome({navigation, recipient}: {navigation: Props['navigation']; recipient?: string}) {
  const receipts = useAppStore(state => state.receipts);
  const merchantProfile = useAppStore(state => state.merchantProfile);
  const settlementMode = useAppStore(state => state.settlementMode);
  const payments = useMerchantPayments(settlementMode === 'testnet' ? merchantProfile?.merchantProfileId : undefined);

  // On Testnet the API knows every request this merchant made, from any device;
  // the demo mode only has what this device recorded.
  const apiPayments = payments.data?.payments ?? [];
  const useApi = settlementMode === 'testnet' && payments.isSuccess;
  const localReceipts = receipts.filter(receipt => receipt.recipient === recipient);
  const received = useApi ? apiPayments : localReceipts;
  const settled = useApi
    ? apiPayments.filter(payment => payment.status === 'confirmed')
    : localReceipts.filter(receipt => receipt.settlementMode === 'testnet');
  const total = settled.reduce((sum, payment) => sum + Number(payment.amount), 0);
  return (
    <>
      <AnimatedContent><SurfaceCard accent="amber" style={styles.merchantHero}>
        <View style={styles.cardHeader}><Text style={styles.cardLabel}>{useApi ? 'RECEIVED' : 'RECORDED ON THIS DEVICE'}</Text><StatusPill tone={received.length > 0 ? 'success' : 'neutral'}>{received.length > 0 ? 'LIVE' : 'NO PAYMENTS'}</StatusPill></View>
        <View style={styles.balanceLine}><CountUp value={total} decimals={2} style={styles.merchantTotal} /><Text style={styles.balanceAsset}>XLM</Text></View>
        <Text style={styles.balanceValue}>
          {payments.isError && settlementMode === 'testnet'
            ? 'The API could not be reached, so this only counts this device.'
            : `${received.length} request${received.length === 1 ? '' : 's'} · ${settled.length} settled`}
        </Text>
        <View style={styles.merchantMetricRow}><View><Text style={styles.metricValue}>{settled.length}</Text><Text style={styles.metricLabel}>Settled</Text></View><View><Text style={styles.metricValue}>{received.length - settled.length}</Text><Text style={styles.metricLabel}>Open</Text></View><View><Text style={styles.metricValue}>{received.length === 0 ? '—' : `${Math.round((settled.length / received.length) * 100)}%`}</Text><Text style={styles.metricLabel}>Completed</Text></View></View>
      </SurfaceCard></AnimatedContent>
      <Button icon={<QrCode color={colors.black} size={20} />} onPress={() => navigation.navigate('MerchantRequest')}>Create payment request</Button>
      <SectionTitle title="Merchant status" />
      <SurfaceCard padded={false} style={styles.statusCard}>
        <View style={styles.statusRow}><View style={styles.capabilityIcon}><ShieldCheck color={colors.success} size={19} /></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>Receiving address verified</Text><Text style={styles.address}>{recipient ? `${recipient.slice(0, 8)}...${recipient.slice(-6)}` : 'No address on file'}</Text></View><StatusPill tone="success">READY</StatusPill></View>
      </SurfaceCard>
    </>
  );
}

function QuickAction({icon, title, hint, onPress, disabled = false, stacked = false}: {icon: ReactNode; title: string; hint: string; onPress?: () => void; disabled?: boolean; stacked?: boolean}) {
  return <PressScale disabled={disabled} onPress={onPress} style={[styles.quickAction, stacked && styles.quickActionStacked, disabled && styles.disabledAction]}><View style={styles.quickIcon}>{icon}</View><View style={styles.quickCopy}><Text style={styles.quickTitle}>{title}</Text><Text style={styles.quickHint}>{hint}</Text></View></PressScale>;
}

function SectionTitle({title, action, onAction}: {title: string; action?: string; onAction?: () => void}) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction} testID="view-all-activity">
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  identity: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  iconButton: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderColor: colors.line, borderRadius: radius.round, borderWidth: 1, height: 38, justifyContent: 'center', width: 38},
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.2},
  greeting: {...typography.title, color: colors.ink, fontSize: 20},
  networkRow: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  network: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderColor: colors.line, borderRadius: radius.round, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 6},
  dot: {backgroundColor: colors.success, borderRadius: radius.round, height: 7, width: 7},
  dotError: {backgroundColor: colors.danger},
  networkText: {...typography.label, color: colors.inkMuted, fontSize: 11},
  balanceCard: {gap: spacing.xs},
  cardHeader: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  cardLabel: {...typography.label, color: colors.amber, fontSize: 11, letterSpacing: 1},
  balanceNetwork: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs},
  balanceNetworkText: {...typography.label, color: colors.inkMuted, fontSize: 11},
  balance: {color: colors.ink, fontSize: 34, fontWeight: '700', lineHeight: 42, marginTop: spacing.sm},
  balanceLine: {alignItems: 'baseline', flexDirection: 'row', gap: spacing.sm},
  balanceAsset: {color: colors.amber, fontSize: 16, fontWeight: '700'},
  balanceValue: {color: colors.inkMuted, fontSize: 13, lineHeight: 18},
  addressRow: {alignItems: 'center', borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md},
  address: {...typography.mono, color: colors.inkMuted, fontSize: 12},
  quickGrid: {flexDirection: 'row', gap: spacing.md},
  quickGridStacked: {flexDirection: 'column'},
  quickAction: {backgroundColor: colors.surface, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flex: 1, gap: spacing.xs, minHeight: 122, padding: spacing.lg},
  quickActionStacked: {alignItems: 'center', flex: 0, flexDirection: 'row', minHeight: 72, width: '100%'},
  disabledAction: {opacity: 0.48},
  quickIcon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.md, height: 40, justifyContent: 'center', marginBottom: spacing.xs, width: 40},
  quickTitle: {...typography.label, color: colors.ink, fontSize: 14},
  quickHint: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  quickCopy: {flex: 1, gap: spacing.xs},
  sectionTitle: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm},
  sectionLabel: {...typography.label, color: colors.ink, fontSize: 14},
  sectionAction: {...typography.label, color: colors.amber, fontSize: 12},
  activityCard: {overflow: 'hidden'},
  activityRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  activityIcon: {alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.round, height: 34, justifyContent: 'center', width: 34},
  activityCopy: {flex: 1, gap: 2},
  activityTitle: {...typography.label, color: colors.ink, fontSize: 13},
  activityHint: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  capabilityCard: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  capabilityIcon: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.round, height: 36, justifyContent: 'center', width: 36},
  capabilityCopy: {flex: 1, gap: 2},
  capabilityTitle: {...typography.label, color: colors.ink},
  capabilityBody: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  merchantHero: {gap: spacing.xs},
  merchantTotal: {color: colors.ink, fontSize: 36, fontWeight: '700', lineHeight: 44, marginTop: spacing.sm},
  merchantMetricRow: {borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md},
  metricValue: {color: colors.ink, fontSize: 17, fontWeight: '700'},
  metricLabel: {color: colors.inkMuted, fontSize: 11, marginTop: 2},
  statusCard: {overflow: 'hidden'},
  statusRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
});
