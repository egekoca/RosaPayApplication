import {useEffect, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {CircleAlert, CircleCheck, Fingerprint, FlaskConical, Radio, Wallet} from 'lucide-react-native';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Button, colors, radius, spacing, SurfaceCard, typography} from '@rosapay/ui';
import {createStellarConfig} from '@rosapay/stellar';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {apiBaseUrl} from '../../shared/apiConfig';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useAppStore, type SettlementMode} from '../../state/appStore';
import {
  getSessionStorageStatus,
  subscribeToSessionStorage,
  type SessionStorageStatus,
} from '../../state/persistence';
import {fetchRelayerIdentity} from '../payments/testnetSettlement';
import {
  createHardwareSigner,
  inspectHardwareSigner,
  verifyHardwareSigner,
  type HardwareSignerReport,
} from './hardwareSigner';
import {ensureCustomerWallet} from '../payments/settlementAdapter';

type Props = NativeStackScreenProps<RootStackParams, 'DeveloperSettings'>;

const modes: {value: SettlementMode; title: string; hint: string}[] = [
  {value: 'mock', title: 'Demo', hint: 'Local only. Nothing is sent to Stellar.'},
  {value: 'testnet', title: 'Testnet', hint: 'Real settlement through the relayer.'},
];

export function DeveloperSettingsScreen(_props: Props) {
  const {settlementMode, setSettlementMode, customerWallet, merchantProfile, merchantRegisteredOnChain, smartWallet} =
    useAppStore();
  const stellarHealth = useStellarHealth();
  const config = createStellarConfig('testnet');
  const [walletError, setWalletError] = useState<string | undefined>();
  const [session, setSession] = useState<SessionStorageStatus>(getSessionStorageStatus);

  useEffect(() => subscribeToSessionStorage(setSession), []);

  const [hardware, setHardware] = useState<HardwareSignerReport>({state: 'unavailable'});
  const [hardwareBusy, setHardwareBusy] = useState(false);

  useEffect(() => {
    void inspectHardwareSigner().then(setHardware);
  }, []);

  const runHardware = (action: () => Promise<HardwareSignerReport>) => async () => {
    setHardwareBusy(true);
    try {
      setHardware(await action());
    } finally {
      setHardwareBusy(false);
    }
  };

  const relayer = useQuery({
    queryKey: ['relayer', apiBaseUrl],
    queryFn: () => fetchRelayerIdentity(apiBaseUrl),
    retry: false,
    staleTime: 30_000,
  });

  const createWallet = async () => {
    setWalletError(undefined);
    try {
      await ensureCustomerWallet();
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'The demo wallet could not be created');
    }
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.title}>Developer settings</Text>
        <Text style={styles.subtitle}>Switch between the local demo and real Testnet settlement.</Text>
      </View>

      <SurfaceCard style={styles.card}>
        <Text style={styles.label}>SETTLEMENT MODE</Text>
        <View style={styles.modes}>
          {modes.map(option => {
            const selected = option.value === settlementMode;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{selected}}
                key={option.value}
                onPress={() => setSettlementMode(option.value)}
                style={[styles.mode, selected && styles.modeSelected]}
                testID={`settlement-mode-${option.value}`}>
                <View style={styles.modeHeader}>
                  {option.value === 'mock' ? (
                    <FlaskConical color={selected ? colors.amber : colors.inkMuted} size={18} />
                  ) : (
                    <Radio color={selected ? colors.amber : colors.inkMuted} size={18} />
                  )}
                  <Text style={[styles.modeTitle, selected && styles.modeTitleSelected]}>{option.title}</Text>
                </View>
                <Text style={styles.modeHint}>{option.hint}</Text>
              </Pressable>
            );
          })}
        </View>
      </SurfaceCard>

      <SurfaceCard padded={false} style={styles.statusCard}>
        <StatusRow
          label="Stellar RPC"
          value={stellarHealth.isPending ? 'Checking' : stellarHealth.isError ? 'Unavailable' : `Ledger ${stellarHealth.data?.latestLedger}`}
          ok={!stellarHealth.isError && !stellarHealth.isPending}
        />
        <StatusRow
          label="Relayer"
          value={relayer.isPending ? 'Checking' : relayer.isError ? 'Not reachable' : shorten(relayer.data?.address)}
          ok={relayer.isSuccess}
        />
        <StatusRow
          label="Settlement contract"
          value={shorten(relayer.data?.settlementContractId ?? config.settlementContractId ?? undefined)}
          ok={Boolean(relayer.data?.settlementContractId ?? config.settlementContractId)}
        />
        <StatusRow label="API" value={apiBaseUrl.replace(/^https?:\/\//, '')} ok={relayer.isSuccess} />
        <StatusRow
          label="Session storage"
          value={
            session.state === 'unavailable'
              ? `Unavailable · ${session.detail?.slice(0, 28) ?? 'unknown'}`
              : session.state === 'unknown'
                ? 'Not written yet'
                : session.state === 'restored'
                  ? 'Restored'
                  : 'Saved on this device'
          }
          ok={session.state === 'saved' || session.state === 'restored'}
        />
        <StatusRow
          label="Device wallet"
          value={smartWallet ? shorten(smartWallet.contractId) : 'Created with the device key'}
          ok={Boolean(smartWallet)}
        />
        <StatusRow
          label="Merchant on-chain"
          value={!merchantProfile ? 'No profile' : merchantRegisteredOnChain ? 'Registered' : 'Not registered'}
          ok={merchantRegisteredOnChain}
          last
        />
      </SurfaceCard>

      <SurfaceCard style={styles.card}>
        <View style={styles.walletHeader}>
          <Fingerprint color={colors.amber} size={18} />
          <Text style={styles.label}>DEVICE PAYMENT KEY</Text>
        </View>
        <Text style={styles.walletValue}>
          {hardware.publicKey ? `${shorten(hardware.publicKey)} · in secure hardware` : 'Not created on this device'}
        </Text>
        <Text style={styles.modeHint}>
          {hardware.detail ?? 'A secp256r1 key that never leaves the device and signs only after you approve.'}
        </Text>
        <Button loading={hardwareBusy} tone="ghost" onPress={runHardware(createHardwareSigner)} testID="create-hardware-key">
          {hardware.publicKey ? 'Replace device key' : 'Create device key'}
        </Button>
        <Button loading={hardwareBusy} tone="ghost" onPress={runHardware(verifyHardwareSigner)} testID="verify-hardware-key">
          Test a signature
        </Button>
      </SurfaceCard>

      <SurfaceCard style={styles.card}>
        <View style={styles.walletHeader}>
          <Wallet color={colors.amber} size={18} />
          <Text style={styles.label}>DEMO CUSTOMER WALLET</Text>
        </View>
        <Text style={styles.walletValue}>
          {customerWallet
            ? `${shorten(customerWallet.publicKey)} · ${customerWallet.funded ? 'funded' : 'not funded yet'}`
            : 'Not created yet'}
        </Text>
        <Text style={styles.modeHint}>
          Stands in for the native signer until the platform modules exist. Testnet funds only.
        </Text>
        {walletError ? <Text style={styles.error}>{walletError}</Text> : null}
        <Button tone="ghost" onPress={createWallet} testID="create-demo-wallet">
          {customerWallet ? 'Recreate demo wallet' : 'Create demo wallet'}
        </Button>
      </SurfaceCard>
    </Screen>
  );
}

function StatusRow({label, value, ok, last}: {label: string; value?: string; ok: boolean; last?: boolean}) {
  return (
    <View style={[styles.statusRow, last && styles.statusRowLast]}>
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={styles.statusValue}>
        <Text style={styles.statusText}>{value ?? '—'}</Text>
        {ok ? <CircleCheck color={colors.success} size={16} /> : <CircleAlert color={colors.inkMuted} size={16} />}
      </View>
    </View>
  );
}

function shorten(value?: string): string {
  if (!value) return '—';
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

const styles = StyleSheet.create({
  heading: {gap: spacing.xs},
  title: {...typography.title, color: colors.ink, fontSize: 24},
  subtitle: {color: colors.inkMuted, fontSize: 13, lineHeight: 19},
  card: {gap: spacing.md},
  label: {...typography.label, color: colors.inkMuted, fontSize: 11, letterSpacing: 0.9},
  modes: {flexDirection: 'row', gap: spacing.md},
  mode: {backgroundColor: colors.surfaceRaised, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flex: 1, gap: spacing.xs, padding: spacing.md},
  modeSelected: {backgroundColor: colors.amberSoft, borderColor: colors.amber},
  modeHeader: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  modeTitle: {...typography.label, color: colors.inkMuted},
  modeTitleSelected: {color: colors.amber},
  modeHint: {color: colors.inkMuted, fontSize: 11, lineHeight: 16},
  statusCard: {overflow: 'hidden'},
  statusRow: {alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', minHeight: 48, paddingHorizontal: spacing.lg},
  statusRowLast: {borderBottomWidth: 0},
  statusLabel: {...typography.label, color: colors.inkMuted, fontSize: 12},
  statusValue: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  statusText: {...typography.mono, color: colors.ink, fontSize: 11},
  walletHeader: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  walletValue: {...typography.mono, color: colors.ink, fontSize: 12},
  error: {...typography.label, color: colors.danger, fontSize: 12},
});
