import {Check, Copy, ExternalLink, KeyRound, Radio, ShieldCheck} from 'lucide-react-native';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import type {ReactNode} from 'react';
import {colors, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import {testnetDeployment} from '@rosapay/stellar';
import {Screen} from '../../shared/Screen';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useWalletBalance} from '../../shared/useWalletBalance';
import {shareValue} from '../../shared/shareAddress';
import {useAppStore} from '../../state/appStore';

export function WalletScreen() {
  const stellarHealth = useStellarHealth();
  const smartWallet = useAppStore(state => state.smartWallet);
  const balance = useWalletBalance();
  const address = smartWallet?.contractId;
  const rpcStatus = stellarHealth.isPending ? 'CHECKING' : stellarHealth.isError ? 'OFFLINE' : 'LIVE';
  const contractId = testnetDeployment.settlementContractId;
  const shortContractId = `${contractId.slice(0, 10)}...${contractId.slice(-8)}`;
  return (
    <Screen>
      <View style={styles.header}><View><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.title}>Wallet</Text></View><StatusPill tone="success">PROTECTED</StatusPill></View>
      <SurfaceCard accent="amber" style={styles.addressCard}>
        <View style={styles.addressHeader}><Text style={styles.label}>STELLAR TESTNET</Text><View style={styles.network}><View style={styles.dot} /><Text style={styles.networkText}>Connected</Text></View></View>
        <Text selectable style={styles.address}>
          {address ? `${address.slice(0, 12)}...${address.slice(-8)}` : 'No wallet on this device yet'}
        </Text>
        <View style={styles.addressFooter}>
          <Text style={styles.helper}>
            {address
              ? balance.data
                ? `${balance.data} XLM held by this wallet`
                : 'Your smart wallet address'
              : 'Create the device payment key to get a wallet'}
          </Text>
          <Pressable
            accessibilityLabel="Share wallet address"
            disabled={!address}
            onPress={() => address && void shareValue('My Rosa Pay wallet', address)}
            style={styles.copyButton}
            testID="share-address">
            <Copy color={address ? colors.amber : colors.inkMuted} size={16} />
            <Text style={styles.copyText}>Share</Text>
          </Pressable>
        </View>
      </SurfaceCard>
      <Text style={styles.sectionTitle}>Security</Text>
      <SurfaceCard padded={false} style={styles.securityCard}>
        <SecurityRow icon={<ShieldCheck color={colors.success} size={19} />} title="Device protected" body="Signing material never enters JavaScript." />
        <View style={styles.separator} />
        <SecurityRow
          icon={<KeyRound color={address ? colors.success : colors.inkMuted} size={19} />}
          title={address ? 'Hardware signer' : 'No device key yet'}
          body={
            address
              ? 'This wallet only moves with a key held in secure hardware, and only after you approve.'
              : 'Create the device payment key in developer settings to hold funds on this device.'
          }
        />
      </SurfaceCard>
      <Text style={styles.sectionTitle}>Network connection</Text>
      <SurfaceCard padded={false} style={styles.networkCard}>
        <View style={styles.networkRow}><View style={styles.liveIcon}><Radio color={stellarHealth.isError ? colors.danger : colors.success} size={18} /></View><View style={styles.networkCopy}><Text style={styles.rowTitle}>Stellar RPC</Text><Text style={styles.body}>{stellarHealth.data ? `Ledger ${stellarHealth.data.latestLedger.toLocaleString()} · Protocol ${stellarHealth.data.protocolVersion}` : stellarHealth.isError ? 'Connection unavailable. Retrying automatically.' : 'Verifying Testnet connection...'}</Text></View><StatusPill tone={stellarHealth.isError ? 'danger' : stellarHealth.isPending ? 'pending' : 'success'}>{rpcStatus}</StatusPill></View>
        <View style={styles.separator} />
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`https://lab.stellar.org/r/testnet/contract/${contractId}`)} style={styles.networkRow}><View style={styles.networkIcon}><ExternalLink color={colors.amber} size={18} /></View><View style={styles.networkCopy}><Text style={styles.rowTitle}>Settlement contract</Text><Text style={[styles.body, styles.contractId]}>{shortContractId}</Text></View><StatusPill tone="success">LIVE</StatusPill></Pressable>
      </SurfaceCard>
    </Screen>
  );
}

function SecurityRow({icon, title, body}: {icon: ReactNode; title: string; body: string}) {
  return <View style={styles.securityRow}><View style={styles.securityIcon}>{icon}</View><View style={styles.networkCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.body}>{body}</Text></View><View style={styles.check}><Check color={colors.success} size={13} strokeWidth={3} /></View></View>;
}

const styles = StyleSheet.create({
  header: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.2},
  title: {...typography.title, color: colors.ink, fontSize: 26, marginTop: 2},
  addressCard: {gap: spacing.sm},
  addressHeader: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  label: {...typography.label, color: colors.amber, fontSize: 11, letterSpacing: 1},
  network: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs},
  dot: {backgroundColor: colors.success, borderRadius: radius.round, height: 7, width: 7},
  networkText: {...typography.label, color: colors.success, fontSize: 11},
  address: {...typography.mono, color: colors.ink, fontSize: 18, marginTop: spacing.md},
  addressFooter: {alignItems: 'center', borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.md},
  helper: {color: colors.inkMuted, fontSize: 12},
  copyButton: {alignItems: 'center', flexDirection: 'row', gap: spacing.xs},
  copyText: {...typography.label, color: colors.amber, fontSize: 12},
  sectionTitle: {...typography.label, color: colors.ink, fontSize: 14, marginTop: spacing.sm},
  securityCard: {overflow: 'hidden'},
  securityRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  securityIcon: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.round, height: 36, justifyContent: 'center', width: 36},
  separator: {backgroundColor: colors.line, height: 1, marginLeft: 68},
  check: {alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.round, height: 20, justifyContent: 'center', width: 20},
  networkCard: {overflow: 'hidden'},
  networkRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  networkIcon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 36, justifyContent: 'center', width: 36},
  liveIcon: {alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.round, height: 36, justifyContent: 'center', width: 36},
  networkCopy: {flex: 1, gap: 2},
  rowTitle: {...typography.label, color: colors.ink, fontSize: 13},
  body: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  contractId: typography.mono,
});
