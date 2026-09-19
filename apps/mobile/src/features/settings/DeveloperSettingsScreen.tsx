import {useEffect, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {CircleAlert, CircleCheck, Fingerprint, FlaskConical, Radio, Wallet} from 'lucide-react-native';
import {Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {Button, colors, radius, spacing, SurfaceCard, TextField, typography} from '@rosapay/ui';
import {createStellarConfig} from '@rosapay/stellar';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {defaultApiBaseUrl, isReachableFromDevice, normalizeApiBaseUrl} from '../../shared/apiConfig';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useAppStore} from '../../state/appStore';
import {
  getSessionStorageStatus,
  subscribeToSessionStorage,
  type SessionStorageStatus,
} from '../../state/persistence';
import {fetchRelayerIdentity} from '../payments/testnetSettlement';
import {useApiHealth} from '../merchant/merchantRequestStatus';
import {
  createHardwareSigner,
  inspectHardwareSigner,
  verifyHardwareSigner,
  type HardwareSignerReport,
} from './hardwareSigner';

type Props = NativeStackScreenProps<RootStackParams, 'DeveloperSettings'>;


export function DeveloperSettingsScreen(_props: Props) {
  const {
    merchantProfile,
    merchantRegisteredOnChain,
    smartWallet,
    apiBaseUrl,
    setApiBaseUrl,
    requireUnlock,
    setRequireUnlock,
  } = useAppStore();
  const stellarHealth = useStellarHealth();
  const config = createStellarConfig('testnet');
  const [session, setSession] = useState<SessionStorageStatus>(getSessionStorageStatus);
  const [apiDraft, setApiDraft] = useState(apiBaseUrl);
  const [apiError, setApiError] = useState<string | undefined>();

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

  const saveApiBaseUrl = () => {
    try {
      const normalized = normalizeApiBaseUrl(apiDraft);
      setApiBaseUrl(normalized);
      setApiDraft(normalized);
      setApiError(
        isReachableFromDevice(normalized)
          ? undefined
          : 'A phone cannot reach localhost on your computer; use its network address.',
      );
      void relayer.refetch();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'That address could not be used');
    }
  };

  const health = useApiHealth();

  const relayer = useQuery({
    queryKey: ['relayer', apiBaseUrl],
    queryFn: () => fetchRelayerIdentity(apiBaseUrl),
    retry: false,
    staleTime: 30_000,
  });

  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.title}>Developer settings</Text>
        <Text style={styles.subtitle}>What this device is talking to, and the key it signs with.</Text>
      </View>

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
          label="API storage"
          value={
            health.isError
              ? 'Not reachable'
              : health.data?.storage === 'postgres'
                ? 'PostgreSQL · records kept'
                : health.data
                  ? 'In memory · lost on restart'
                  : 'Checking'
          }
          ok={health.data?.storage === 'postgres'}
        />
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
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>Ask for me when the app opens</Text>
            <Text style={styles.toggleBody}>
              Off by default. Paying always asks, whatever this says.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Ask for me when the app opens"
            onValueChange={setRequireUnlock}
            testID="require-unlock"
            thumbColor={colors.white}
            trackColor={{false: colors.line, true: colors.amber}}
            value={requireUnlock}
          />
        </View>
      </SurfaceCard>

      <SurfaceCard style={styles.card}>
        <Text style={styles.label}>API ADDRESS</Text>
        <TextField
          autoCapitalize="none"
          hint="On a phone, use your computer's network address, such as http://192.168.1.10:4100"
          label=""
          onChangeText={value => {
            setApiDraft(value);
            setApiError(undefined);
          }}
          placeholder={defaultApiBaseUrl}
          testID="api-base-url"
          value={apiDraft}
          {...(apiError ? {error: apiError} : {})}
        />
        <Button tone="ghost" onPress={saveApiBaseUrl} testID="save-api-base-url">Use this address</Button>
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
  toggleRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between'},
  toggleCopy: {flex: 1, gap: 4},
  toggleTitle: {...typography.body, color: colors.ink, fontWeight: '600'},
  toggleBody: {...typography.body, color: colors.inkMuted, fontSize: 13, lineHeight: 18},
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
