import {ArrowDownToLine, Banknote, ArrowUpFromLine, Check, Copy, ExternalLink, KeyRound, Lock, LogOut, Minus, Radio, ShieldCheck, UserRound} from 'lucide-react-native';
import {useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import type {ReactNode} from 'react';
import {colors, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import {testnetDeployment} from '@rosapay/stellar';
import {Screen} from '../../shared/Screen';
import {displayAmount} from '../../shared/displayAmount';
import type {Holding} from '../../shared/useWalletBalance';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useWalletBalance} from '../../shared/useWalletBalance';
import {shareValue} from '../../shared/shareAddress';
import {useAppStore} from '../../state/appStore';

type WalletNavigation = {
  navigate(screen: 'AnchorTransfer', params: {kind: 'deposit' | 'withdraw'}): void;
  navigate(screen: 'LiraDeposit'): void;
};

export function WalletScreen({navigation}: {navigation?: WalletNavigation} = {}) {
  const stellarHealth = useStellarHealth();
  const smartWallet = useAppStore(state => state.smartWallet);
  const account = useAppStore(state => state.account);
  const lock = useAppStore(state => state.lock);
  const signOut = useAppStore(state => state.signOut);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const balance = useWalletBalance();
  const address = smartWallet?.contractId;
  const rpcStatus = stellarHealth.isPending ? 'CHECKING' : stellarHealth.isError ? 'OFFLINE' : 'LIVE';
  const contractId = testnetDeployment.settlementContractId;
  const shortContractId = `${contractId.slice(0, 10)}...${contractId.slice(-8)}`;
  async function eraseAccount() {
    if (!confirmingSignOut) {
      setConfirmingSignOut(true);
      return;
    }
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'This device could not erase the payment key.');
    }
  }
  return (
    <Screen>
      <View style={styles.header}><View><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.title}>Wallet</Text></View><StatusPill tone="success">PROTECTED</StatusPill></View>
      {account ? (
        <SurfaceCard style={styles.accountCard}>
          <View style={styles.accountRow}>
            <View style={styles.avatar}>
              <UserRound color={colors.amber} size={22} />
            </View>
            <View style={styles.accountCopy}>
              <Text style={styles.accountName} numberOfLines={1}>{account.name}</Text>
              <Text style={styles.accountDetail} numberOfLines={1}>
                {account.email ?? 'No email — receipts stay on this phone'}
              </Text>
            </View>
          </View>
          <View style={styles.accountActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => lock()}
              style={styles.accountAction}
              testID="lock-now">
              <Lock color={colors.ink} size={16} />
              <Text style={styles.accountActionText}>Lock now</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={eraseAccount}
              style={styles.accountAction}
              testID="wallet-sign-out">
              <LogOut color={confirmingSignOut ? colors.danger : colors.inkMuted} size={16} />
              <Text style={[styles.accountActionText, styles.signOutText, confirmingSignOut && styles.signOutConfirm]}>
                {confirmingSignOut ? 'Tap again to erase' : 'Sign out'}
              </Text>
            </Pressable>
          </View>
          {confirmingSignOut ? (
            <Text style={styles.signOutWarning}>
              This erases the account, its receipts and its business profile from this phone. Anything already settled
              stays on Stellar.
            </Text>
          ) : null}
          {signOutError ? <Text accessibilityRole="alert" style={styles.signOutError}>{signOutError}</Text> : null}
        </SurfaceCard>
      ) : null}
      <SurfaceCard accent="amber" style={styles.addressCard}>
        <View style={styles.addressHeader}><Text style={styles.label}>STELLAR TESTNET</Text><View style={styles.network}><View style={styles.dot} /><Text style={styles.networkText}>Connected</Text></View></View>
        <Text selectable style={styles.address}>
          {address ? `${address.slice(0, 12)}...${address.slice(-8)}` : 'No wallet on this device yet'}
        </Text>
        <View style={styles.addressFooter}>
          <Text style={styles.helper}>
            {address
              ? heldLabel(balance.data) ?? 'Your smart wallet address'
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
      {/*
        Lira first, because it is the money the people using this count in, and
        because it is the one route that ends in a balance they can spend at a
        counter rather than a Testnet faucet.
      */}
      <Text style={styles.sectionTitle}>Turkish lira</Text>
      <SurfaceCard padded={false} style={styles.transferCard}>
        <Pressable
          accessibilityRole="button"
          disabled={!navigation}
          onPress={() => navigation?.navigate('LiraDeposit')}
          style={[styles.transferRow, !navigation && styles.disabledAction]}
          testID="add-lira">
          <View style={styles.transferIcon}><Banknote color={colors.goldBright} size={19} /></View>
          <View style={styles.networkCopy}>
            <Text style={styles.rowTitle}>Add money with lira</Text>
            <Text style={styles.body}>Bank transfer in TRY · receive USDC</Text>
          </View>
        </Pressable>
      </SurfaceCard>
      <Text style={styles.sectionTitle}>Testnet anchor</Text>
      <SurfaceCard padded={false} style={styles.transferCard}>
        <Pressable
          accessibilityRole="button"
          disabled={!address || !navigation}
          onPress={() => navigation?.navigate('AnchorTransfer', {kind: 'deposit'})}
          style={[styles.transferRow, (!address || !navigation) && styles.disabledAction]}
          testID="add-money">
          <View style={styles.transferIcon}><ArrowDownToLine color={colors.amber} size={19} /></View>
          <View style={styles.networkCopy}>
            <Text style={styles.rowTitle}>Add money</Text>
            <Text style={styles.body}>Hosted SEP-24 deposit · Testnet XLM</Text>
          </View>
        </Pressable>
        <View style={styles.separator} />
        <Pressable
          accessibilityRole="button"
          disabled={!address || !navigation}
          onPress={() => navigation?.navigate('AnchorTransfer', {kind: 'withdraw'})}
          style={[styles.transferRow, (!address || !navigation) && styles.disabledAction]}
          testID="withdraw-money">
          <View style={styles.transferIcon}><ArrowUpFromLine color={colors.lemon} size={19} /></View>
          <View style={styles.networkCopy}>
            <Text style={styles.rowTitle}>Withdraw</Text>
            <Text style={styles.body}>Hosted SEP-24 withdrawal · Testnet XLM</Text>
          </View>
        </Pressable>
      </SurfaceCard>
      <Text style={styles.sectionTitle}>Security</Text>
      <SurfaceCard padded={false} style={styles.securityCard}>
        <SecurityRow
          satisfied={Boolean(address)}
          icon={<ShieldCheck color={address ? colors.success : colors.inkMuted} size={19} />}
          title={address ? 'Asked for at every payment' : 'No wallet on this phone yet'}
          body={
            address
              ? 'Your key is kept behind your face or fingerprint, and nothing is signed until you approve it.'
              : 'Create a wallet to protect payments with this device.'
          }
        />
        <View style={styles.separator} />
        <SecurityRow
          satisfied={Boolean(address)}
          icon={<KeyRound color={address ? colors.success : colors.inkMuted} size={19} />}
          title={address ? 'Non-exportable device key' : 'No device key yet'}
          body={
            address
              ? 'Signing material stays in secure hardware. JavaScript receives only the public key and an opaque signature result.'
              : 'The payment key will be generated in secure hardware and cannot be exported by the app.'
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

/**
 * A row in the security list. The tick reports whether the protection is
 * actually in place — an unsatisfied row used to carry the same green check as
 * a satisfied one, which told someone with no device key that they had one.
 */
function SecurityRow({satisfied, icon, title, body}: {satisfied: boolean; icon: ReactNode; title: string; body: string}) {
  return (
    <View style={styles.securityRow}>
      <View style={styles.securityIcon}>{icon}</View>
      <View style={styles.networkCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <View style={[styles.check, !satisfied && styles.checkPending]}>
        {satisfied ? (
          <Check color={colors.success} size={13} strokeWidth={3} />
        ) : (
          <Minus color={colors.inkMuted} size={13} strokeWidth={3} />
        )}
      </View>
    </View>
  );
}

/**
 * What the wallet holds, in one line.
 *
 * The balance query answers with one entry per payable asset, so the lumens
 * have to be picked out by name rather than assumed to be the only one.
 */
function heldLabel(holdings: Holding[] | undefined): string | undefined {
  const lumens = holdings?.find(holding => holding.code === 'XLM');
  return lumens ? `${displayAmount(lumens.amount)} XLM held by this wallet` : undefined;
}

const styles = StyleSheet.create({
  header: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.2},
  title: {...typography.title, color: colors.ink, fontSize: 26, marginTop: 2},
  accountCard: {gap: spacing.lg},
  accountRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  avatar: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 48, justifyContent: 'center', width: 48},
  accountCopy: {flex: 1, gap: 2},
  accountName: {...typography.title, color: colors.ink, fontSize: 18},
  accountDetail: {color: colors.inkMuted, fontSize: 13},
  accountActions: {borderTopColor: colors.lineSoft, borderTopWidth: 1, flexDirection: 'row', gap: spacing.xl, paddingTop: spacing.lg},
  accountAction: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  accountActionText: {...typography.label, color: colors.ink, fontSize: 13},
  signOutText: {color: colors.inkMuted},
  signOutConfirm: {color: colors.danger},
  signOutWarning: {color: colors.inkFaint, fontSize: 12, lineHeight: 18},
  signOutError: {color: colors.danger, fontSize: 12, lineHeight: 18},
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
  transferCard: {overflow: 'hidden'},
  transferRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  transferIcon: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.round, height: 38, justifyContent: 'center', width: 38},
  disabledAction: {opacity: 0.4},
  securityCard: {overflow: 'hidden'},
  securityRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  securityIcon: {alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.round, height: 36, justifyContent: 'center', width: 36},
  separator: {backgroundColor: colors.line, height: 1, marginLeft: 68},
  check: {alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.round, height: 20, justifyContent: 'center', width: 20},
  checkPending: {backgroundColor: colors.surfaceRaised},
  networkCard: {overflow: 'hidden'},
  networkRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  networkIcon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 36, justifyContent: 'center', width: 36},
  liveIcon: {alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: radius.round, height: 36, justifyContent: 'center', width: 36},
  networkCopy: {flex: 1, gap: 2},
  rowTitle: {...typography.label, color: colors.ink, fontSize: 13},
  body: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  contractId: typography.mono,
});
