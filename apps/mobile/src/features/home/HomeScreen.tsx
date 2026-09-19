import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ChevronRight, Copy, QrCode, ReceiptText, ScanLine, ShieldCheck, SlidersHorizontal, Store} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import type {ReactNode} from 'react';
import {AnimatedContent, Button, colors, CountUp, PressScale, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {ModeSwitcher} from '../../shared/ModeSwitcher';
import {LumenadeMark} from '../../shared/LumenadeMark';
import {useMerchantPayments} from '../merchant/merchantRequestStatus';
import {Screen} from '../../shared/Screen';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useWalletBalance} from '../../shared/useWalletBalance';
import {useBalanceValue} from '../../shared/useBalanceValue';
import {shareValue} from '../../shared/shareAddress';
import {useAppStore} from '../../state/appStore';
import {greetingFor} from './greeting';
import {PaymentCard} from './PaymentCard';

type Props = NativeStackScreenProps<RootStackParams, 'Main'>;

export function HomeScreen({navigation}: Props) {
  const {width} = useWindowDimensions();
  const {mode, merchantProfile, account} = useAppStore();
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
      {merchantEnabled ? <ModeSwitcher /> : null}
      {mode === 'customer' ? (
        <CustomerHome navigation={navigation} merchantEnabled={merchantEnabled} />
      ) : (
        <MerchantHome navigation={navigation} recipient={merchantProfile?.recipient} />
      )}
    </Screen>
  );
}

/**
 * Everything a customer does, on one screen.
 *
 * Paying and looking back at what you paid is the whole job, so the card, the
 * one action and the history sit together rather than behind three tabs. A tab
 * bar is a promise of somewhere else to go, and there is nowhere else.
 */
function CustomerHome({navigation, merchantEnabled}: {navigation: Props['navigation']; merchantEnabled: boolean}) {
  const smartWallet = useAppStore(state => state.smartWallet);
  const receipts = useAppStore(state => state.receipts);
  const balance = useWalletBalance();
  const value = useBalanceValue(balance.data);
  const address = smartWallet?.contractId;

  return (
    <>
      <AnimatedContent>
        <PaymentCard
          holdings={balance.data ?? []}
          {...(value.data ? {value: value.data} : {})}
          {...(address === undefined ? {} : {address})}
          state={
            !smartWallet ? 'no-wallet' : balance.isPending ? 'loading' : balance.isError ? 'error' : 'ready'
          }
          onCopy={() => address && void shareValue('My Lumenade Pay wallet', address)}
        />
      </AnimatedContent>

      <AnimatedContent delay={90}>
        <PressScale>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Scan')}
            style={styles.scanAction}
            testID="scan-to-pay">
            <View style={styles.scanIcon}>
              <ScanLine color={colors.black} size={24} />
            </View>
            <View style={styles.scanCopy}>
              <Text style={styles.scanTitle}>Scan to pay</Text>
              <Text style={styles.scanHint}>Point at the code, or hold the phones together</Text>
            </View>
            <ChevronRight color={colors.inkMuted} size={19} />
          </Pressable>
        </PressScale>
      </AnimatedContent>

      <AnimatedContent delay={160}>
        <Text style={styles.listTitle}>Payments</Text>
        {receipts.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyTitle}>Nothing yet</Text>
            <Text style={styles.emptyHint}>What you pay for shows up here, with a link to the transaction.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {receipts.slice(0, 6).map(receipt => (
              <Pressable
                key={receipt.intentId}
                accessibilityRole="button"
                onPress={() => navigation.navigate('Receipt', {receipt})}
                style={styles.listRow}>
                <View style={styles.listIcon}>
                  <ReceiptText color={colors.success} size={17} />
                </View>
                <View style={styles.listCopy}>
                  <Text style={styles.listName} numberOfLines={1}>{receipt.merchantName}</Text>
                  <Text style={styles.listWhen}>{new Date(receipt.createdAt).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.listAmount}>−{receipt.amount} {receipt.assetCode}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </AnimatedContent>

      {!merchantEnabled && (
        <AnimatedContent delay={230}>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('MerchantOnboarding')}
            style={styles.merchantRow}
            testID="activate-merchant">
            <Store color={colors.amber} size={18} />
            <Text style={styles.merchantText}>Get paid with this account</Text>
            <ChevronRight color={colors.inkMuted} size={17} />
          </Pressable>
        </AnimatedContent>
      )}
    </>
  );
}

function MerchantHome({navigation, recipient}: {navigation: Props['navigation']; recipient?: string}) {
  const receipts = useAppStore(state => state.receipts);
  const merchantProfile = useAppStore(state => state.merchantProfile);
  const payments = useMerchantPayments(merchantProfile?.merchantProfileId);

  // On Testnet the API knows every request this merchant made, from any device;
  // a device on its own only has what it recorded itself.
  const apiPayments = payments.data?.payments ?? [];
  const useApi = payments.isSuccess;
  const localReceipts = receipts.filter(receipt => receipt.recipient === recipient);
  const received = useApi ? apiPayments : localReceipts;
  const settled = useApi
    ? apiPayments.filter(payment => payment.status === 'confirmed')
    : localReceipts;
  const total = settled.reduce((sum, payment) => sum + Number(payment.amount), 0);
  return (
    <>
      <AnimatedContent><SurfaceCard accent="amber" style={styles.merchantHero}>
        <View style={styles.cardHeader}><Text style={styles.cardLabel}>{useApi ? 'RECEIVED' : 'RECORDED ON THIS DEVICE'}</Text><StatusPill tone={received.length > 0 ? 'success' : 'neutral'}>{received.length > 0 ? 'LIVE' : 'NO PAYMENTS'}</StatusPill></View>
        <View style={styles.balanceLine}><CountUp value={total} decimals={2} style={styles.merchantTotal} /><Text style={styles.balanceAsset}>XLM</Text></View>
        <Text style={styles.balanceValue}>
          {payments.isError
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
  scanAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.lg,
  },
  scanIcon: {
    alignItems: 'center',
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  scanCopy: {flex: 1, gap: 3},
  scanTitle: {...typography.title, color: colors.ink, fontSize: 18},
  scanHint: {color: colors.inkMuted, fontSize: 13, lineHeight: 18},

  listTitle: {...typography.overline, color: colors.inkFaint, marginBottom: spacing.md, marginTop: spacing.xxl},
  list: {gap: 2},
  listRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  listIcon: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderRadius: radius.sm,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  listCopy: {flex: 1, gap: 2},
  listName: {...typography.label, color: colors.ink, fontSize: 15},
  listWhen: {color: colors.inkFaint, fontSize: 12},
  listAmount: {...typography.label, color: colors.ink, fontSize: 14},

  emptyRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.xs,
    padding: spacing.xl,
  },
  emptyTitle: {...typography.label, color: colors.ink, fontSize: 15},
  emptyHint: {color: colors.inkMuted, fontSize: 13, lineHeight: 19},

  merchantRow: {
    alignItems: 'center',
    borderTopColor: colors.lineSoft,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xxl,
    paddingTop: spacing.xl,
  },
  merchantText: {...typography.label, color: colors.ink, flex: 1, fontSize: 14},


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
