import {isFinal, transactionPhase, type AnchorTransaction} from '@rosapay/anchor';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {ArrowDownToLine, ArrowUpFromLine, ExternalLink, RefreshCw, ShieldCheck} from 'lucide-react-native';
import {useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import {InAppBrowser} from 'react-native-inappbrowser-reborn';
import {Button, colors, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';

import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {useAppStore, type PendingAnchorTransfer} from '../../state/appStore';
import {
  resumeWalletAnchorTransfer,
  startWalletAnchorTransfer,
  TESTNET_ANCHOR_HOME_DOMAIN,
} from './anchorTransfer';

type Props = NativeStackScreenProps<RootStackParams, 'AnchorTransfer'>;

export function AnchorTransferScreen({route}: Props) {
  const kind = route.params.kind;
  const smartWallet = useAppStore(state => state.smartWallet);
  const apiBaseUrl = useAppStore(state => state.apiBaseUrl);
  const savedTransfer = useAppStore(state => state.pendingAnchorTransfer);
  const setSavedTransfer = useAppStore(state => state.setPendingAnchorTransfer);
  const matchingSaved = savedTransfer?.kind === kind ? savedTransfer : null;
  const conflictingSaved = savedTransfer && savedTransfer.kind !== kind ? savedTransfer : null;
  const [transaction, setTransaction] = useState<AnchorTransaction | null>(null);
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDeposit = kind === 'deposit';
  const title = isDeposit ? 'Add money' : 'Withdraw';
  const Icon = isDeposit ? ArrowDownToLine : ArrowUpFromLine;
  const phase = transaction ? transactionPhase(transaction.status) : matchingSaved ? 'pending' : null;

  async function openHostedFlow(url: string) {
    if (await InAppBrowser.isAvailable()) {
      await InAppBrowser.open(url);
    } else {
      await Linking.openURL(url);
    }
  }

  async function follow(pending: PendingAnchorTransfer) {
    const latest = await resumeWalletAnchorTransfer({pending, onUpdate: setTransaction});
    setTransaction(latest);
    if (isFinal(latest.status)) setSavedTransfer(null);
  }

  async function start() {
    if (!smartWallet) {
      setError('Create the device-protected smart wallet before connecting an anchor.');
      return;
    }
    if (conflictingSaved) {
      setError(`Finish or forget the saved ${conflictingSaved.kind} before starting another transfer.`);
      return;
    }
    setBusy(true);
    setError(null);
    setTransaction(null);
    try {
      const started = await startWalletAnchorTransfer({kind, smartWallet, apiBaseUrl});
      setSavedTransfer(started.pending);
      setInteractiveUrl(started.interactiveUrl);
      await openHostedFlow(started.interactiveUrl);
      await follow(started.pending);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The anchor flow could not be started.');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!matchingSaved) return;
    setBusy(true);
    setError(null);
    try {
      await follow(matchingSaved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The transfer status could not be refreshed.');
    } finally {
      setBusy(false);
    }
  }

  async function returnToAnchor() {
    if (!interactiveUrl) return;
    setError(null);
    try {
      await openHostedFlow(interactiveUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The anchor page could not be opened.');
    }
  }

  function forgetSavedStatus() {
    setSavedTransfer(null);
    setTransaction(null);
    setInteractiveUrl(null);
    setError(null);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.icon}><Icon color={colors.amber} size={24} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>STELLAR TESTNET · XLM</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        {phase ? <StatusPill tone={phaseTone(phase)}>{phaseLabel(phase)}</StatusPill> : null}
      </View>

      <SurfaceCard accent="amber" style={styles.anchorCard}>
        <View style={styles.row}>
          <ShieldCheck color={colors.success} size={20} />
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>Hosted by {TESTNET_ANCHOR_HOME_DOMAIN}</Text>
            <Text style={styles.body}>
              Rosa Pay verifies the anchor challenge before your device approves it. Identity and bank details stay on
              the anchor's page.
            </Text>
          </View>
        </View>
      </SurfaceCard>

      {transaction || matchingSaved ? (
        <SurfaceCard style={styles.statusCard}>
          <Text style={styles.label}>TRANSFER STATUS</Text>
          <Text style={styles.status}>{transaction?.status ?? 'Saved — ready to refresh'}</Text>
          <Text selectable style={styles.id}>{transaction?.id ?? matchingSaved?.transactionId}</Text>
          {transaction?.message ? <Text style={styles.body}>{transaction.message}</Text> : null}
          {transaction?.stellar_transaction_id ? (
            <Text selectable style={styles.hash}>Stellar transaction: {transaction.stellar_transaction_id}</Text>
          ) : null}
        </SurfaceCard>
      ) : (
        <SurfaceCard style={styles.explainer}>
          <Text style={styles.cardTitle}>{isDeposit ? 'Funds land in the smart wallet' : 'The smart wallet remains the source'}</Text>
          <Text style={styles.body}>
            {isDeposit
              ? 'SEP-45 authenticates the C-account directly, so Rosa Pay does not create a classic holding account or a trustline sweep.'
              : 'The anchor collects the withdrawal details. If it requests an on-chain transfer, Rosa Pay will keep the transfer action-required until that smart-wallet payment is approved.'}
          </Text>
        </SurfaceCard>
      )}

      {conflictingSaved ? (
        <Text style={styles.warning}>
          A saved {conflictingSaved.kind} is still being tracked. Open that flow or forget it before starting another.
        </Text>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {interactiveUrl && transaction && transactionPhase(transaction.status) === 'action_required' ? (
        <Button onPress={returnToAnchor} tone="secondary" icon={<ExternalLink color={colors.ink} size={18} />}>
          Return to anchor
        </Button>
      ) : null}
      {matchingSaved ? (
        <>
          <Button
            testID="refresh-anchor-transfer"
            onPress={refresh}
            loading={busy}
            icon={<RefreshCw color={colors.black} size={18} />}>
            Refresh status
          </Button>
          <Button onPress={forgetSavedStatus} tone="ghost">Forget saved status</Button>
        </>
      ) : (
        <Button
          testID="start-anchor-transfer"
          disabled={!smartWallet || Boolean(conflictingSaved)}
          onPress={start}
          loading={busy}
          icon={<Icon color={colors.black} size={18} />}>
          Continue to anchor
        </Button>
      )}
      <Text style={styles.disclaimer}>
        Testnet only. No real money moves. Closing the browser does not cancel a transfer; its ID is stored securely so
        status checks can resume.
      </Text>
    </Screen>
  );
}

function phaseTone(phase: ReturnType<typeof transactionPhase>): 'success' | 'pending' | 'danger' {
  if (phase === 'completed') return 'success';
  if (phase === 'failed') return 'danger';
  return 'pending';
}

function phaseLabel(phase: ReturnType<typeof transactionPhase>): string {
  return ({action_required: 'ACTION', pending: 'PENDING', completed: 'DONE', failed: 'FAILED'} as const)[phase];
}

const styles = StyleSheet.create({
  header: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  headerCopy: {flex: 1},
  icon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 46, justifyContent: 'center', width: 46},
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1},
  title: {...typography.title, color: colors.ink, fontSize: 26, marginTop: 2},
  anchorCard: {gap: spacing.md},
  row: {alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md},
  copy: {flex: 1, gap: spacing.xs},
  cardTitle: {...typography.label, color: colors.ink, fontSize: 14},
  body: {color: colors.inkMuted, fontSize: 13, lineHeight: 19},
  statusCard: {gap: spacing.sm},
  label: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1},
  status: {...typography.title, color: colors.ink, fontSize: 20},
  id: {...typography.mono, color: colors.inkMuted, fontSize: 11},
  hash: {...typography.mono, color: colors.inkMuted, fontSize: 11, lineHeight: 16},
  explainer: {gap: spacing.sm},
  error: {backgroundColor: colors.dangerSoft, borderRadius: radius.md, color: colors.danger, fontSize: 13, lineHeight: 19, padding: spacing.md},
  warning: {backgroundColor: colors.amberSoft, borderRadius: radius.md, color: colors.inkMuted, fontSize: 13, lineHeight: 19, padding: spacing.md},
  disclaimer: {color: colors.inkFaint, fontSize: 11, lineHeight: 17, textAlign: 'center'},
});
