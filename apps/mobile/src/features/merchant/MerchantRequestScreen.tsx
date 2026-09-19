import {useState, type ReactNode} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Nfc, Store} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import {StyleSheet, Text, View} from 'react-native';
import {Button, colors, radius, spacing, StatusPill, SurfaceCard, TextField, typography} from '@rosapay/ui';
import {encodePaymentQr, type SignedPaymentIntentV1} from '@rosapay/protocol';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {createRandomBytes} from '../../shared/randomBytes';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useAppStore} from '../../state/appStore';
import {mobileSettlementMode} from '../payments/settlementAdapter';
import {useNfcBroadcast} from '../payments/useNfc';
import {createSignedPaymentRequest, MerchantProfileError} from './merchantProfile';
import {registerMerchantForTestnet} from './merchantRegistration';
import {publishPaymentRequest, useRelayerIdentity, usePaymentRequestStatus} from './merchantRequestStatus';
import {useMerchantCountersigning} from './merchantCountersigning';

type Props = NativeStackScreenProps<RootStackParams, 'MerchantRequest'>;

const randomBytes = createRandomBytes({allowInsecureFallback: mobileSettlementMode === 'mock'});

export function MerchantRequestScreen({navigation}: Props) {
  const {
    merchantProfile,
    pendingRequest,
    setPendingRequest,
    settlementMode,
    merchantRegisteredOnChain,
    setMerchantRegisteredOnChain,
  } = useAppStore();
  const stellarHealth = useStellarHealth();
  const settlement = usePaymentRequestStatus(
    settlementMode === 'testnet' ? pendingRequest?.intent.intentId ?? '' : '',
  );
  const relayer = useRelayerIdentity();
  // A customer on another phone cannot produce the merchant's signature, so this
  // device signs for them as soon as they claim the request.
  useMerchantCountersigning({
    request: pendingRequest,
    profile: merchantProfile,
    relayerAddress: relayer.data?.address,
    settlementContractId: relayer.data?.settlementContractId,
    enabled: settlementMode === 'testnet' && settlement.data?.status === 'awaiting_approval',
  });
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [registering, setRegistering] = useState(false);

  if (!merchantProfile) {
    return (
      <Screen contentStyle={styles.centered}>
        <Text style={styles.subtitle}>Set up your business profile before creating a payment request.</Text>
        <Button onPress={() => navigation.replace('MerchantOnboarding')}>Set up business</Button>
      </Screen>
    );
  }

  const registerOnChain = async () => {
    if (!merchantProfile) return;
    setError(undefined);
    setRegistering(true);
    try {
      await registerMerchantForTestnet(merchantProfile);
      setMerchantRegisteredOnChain(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Testnet registration failed');
    } finally {
      setRegistering(false);
    }
  };

  const createRequest = () => {
    setError(undefined);
    try {
      const request = createSignedPaymentRequest(
        merchantProfile,
        {amount, reference, latestLedger: stellarHealth.data?.latestLedger},
        randomBytes,
      );
      setPendingRequest(request);
      // Testnet payments settle against an intent the API already knows about.
      if (settlementMode === 'testnet') {
        void publishPaymentRequest(request).catch(failure => {
          setError(failure instanceof Error ? failure.message : 'The request could not be published to the API');
        });
      }
    } catch (failure) {
      setError(
        failure instanceof MerchantProfileError || failure instanceof Error
          ? failure.message
          : 'The payment request could not be created',
      );
    }
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <View style={styles.merchantIcon}><Store color={colors.amber} size={22} /></View>
        <Text style={styles.eyebrow}>{merchantProfile.displayName.toUpperCase()}</Text>
        <Text style={styles.title}>Payment request</Text>
        <Text style={styles.subtitle}>
          {pendingRequest ? 'Show this code to your customer' : 'Enter what the customer owes'}
        </Text>
      </View>

      {settlementMode === 'testnet' && !merchantRegisteredOnChain ? (
        <SurfaceCard style={styles.warning}>
          <Text style={styles.warningTitle}>Not registered on Testnet</Text>
          <Text style={styles.warningBody}>
            The settlement contract only accepts requests from a registered merchant key.
          </Text>
          <Button loading={registering} tone="ghost" onPress={() => void registerOnChain()} testID="register-merchant">
            {registering ? 'Registering' : 'Register this business'}
          </Button>
        </SurfaceCard>
      ) : null}

      {pendingRequest ? (
        <RequestCard
          request={pendingRequest}
          latestLedger={stellarHealth.data?.latestLedger}
          onReset={() => setPendingRequest(null)}
          onPreview={() => navigation.navigate('Confirm', {payload: pendingRequest})}
          settlementStatus={settlementMode === 'testnet' ? settlement.data?.status : undefined}
          status={settlementMode === 'testnet' ? <RequestStatus intentId={pendingRequest.intent.intentId} /> : null}
        />
      ) : (
        <>
          <SurfaceCard style={styles.form}>
            <TextField
              keyboardType="decimal-pad"
              label="AMOUNT (XLM)"
              maxLength={20}
              onChangeText={setAmount}
              placeholder="24.5"
              testID="request-amount"
              value={amount}
            />
            <TextField
              label="REFERENCE"
              maxLength={120}
              onChangeText={setReference}
              placeholder="Table 08"
              testID="request-reference"
              value={reference}
            />
          </SurfaceCard>
          <View style={styles.ledgerRow}>
            <View style={[styles.dot, stellarHealth.isError && styles.dotError]} />
            <Text style={styles.ledgerText}>
              {stellarHealth.isPending
                ? 'Reading the Testnet ledger'
                : stellarHealth.isError
                  ? 'Testnet unavailable, so an expiry cannot be set'
                  : `Expires about 10 minutes after ledger ${stellarHealth.data?.latestLedger}`}
            </Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button onPress={createRequest} testID="create-request">Create payment request</Button>
        </>
      )}
    </Screen>
  );
}

function RequestStatus({intentId}: {intentId: string}) {
  const status = usePaymentRequestStatus(intentId);
  const settlement = status.data;
  const tone = settlement?.status === 'confirmed' ? 'success' : settlement?.status === 'failed' ? 'danger' : 'pending';

  return (
    <SurfaceCard style={styles.statusCard}>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>PAYMENT STATUS</Text>
        <StatusPill tone={tone}>{(settlement?.status ?? (status.isPending ? 'checking' : 'unknown')).toUpperCase()}</StatusPill>
      </View>
      <Text style={styles.statusBody}>
        {settlement?.status === 'confirmed'
          ? `Settled in ledger ${settlement.ledger} · ${settlement.transactionHash?.slice(0, 16)}…`
          : settlement?.status === 'submitted'
            ? 'Sent to Stellar, waiting for the ledger to confirm it.'
            : settlement?.status === 'authorized'
              ? 'The customer authorized this payment.'
              : settlement?.status === 'failed'
                ? `Settlement failed: ${settlement.failureCode ?? 'unknown reason'}`
                : status.isError
                  ? 'The API could not be reached, so the status is unknown here.'
                  : 'Waiting for a customer to pay this request.'}
      </Text>
    </SurfaceCard>
  );
}

function RequestCard({
  request,
  latestLedger,
  onReset,
  onPreview,
  status,
  settlementStatus,
}: {
  request: SignedPaymentIntentV1;
  latestLedger: number | undefined;
  onReset: () => void;
  onPreview: () => void;
  status?: ReactNode;
  settlementStatus?: string;
}) {
  const remaining = latestLedger === undefined ? undefined : request.intent.expiresAtLedger - latestLedger;
  // Once a payment has moved, its outcome is what matters; the expiry window
  // only describes a request that is still waiting for a customer.
  const settled = settlementStatus !== undefined && settlementStatus !== 'awaiting_approval';
  const expired = !settled && remaining !== undefined && remaining <= 0;
  const encoded = encodePaymentQr(request);
  // A request that has been paid or has expired stops being offered to taps, so
  // the QR on screen and what NFC hands out never disagree.
  const nfc = useNfcBroadcast(settled || expired ? null : encoded);
  return (
    <>
      <SurfaceCard style={styles.requestCard}>
        <View style={styles.requestHeader}>
          <View>
            <Text style={styles.amount}>{request.intent.amount} <Text style={styles.asset}>{request.intent.asset.code}</Text></Text>
            <Text style={styles.reference}>{request.intent.reference}</Text>
          </View>
          <StatusPill tone={settled ? (settlementStatus === 'confirmed' ? 'success' : 'pending') : expired ? 'danger' : 'pending'}>
            {settled ? settlementStatus!.replace(/_/g, ' ').toUpperCase() : expired ? 'EXPIRED' : 'PENDING'}
          </StatusPill>
        </View>
        <View style={styles.qr}>
          <QRCode value={encoded} size={214} color={colors.black} backgroundColor="#FFFFFF" />
        </View>
        {nfc.canBroadcast && nfc.enabled && !settled && !expired ? (
          <View style={styles.nfcRow}>
            <Nfc color={colors.amber} size={18} />
            <Text style={styles.nfcText}>Or let the customer tap their phone here</Text>
          </View>
        ) : null}
        <View style={styles.expiry}>
          <View style={[styles.dot, expired && styles.dotError, settled && styles.dotDone]} />
          <Text style={styles.expiryText}>
            {settled
              ? 'A customer has paid this request'
              : remaining === undefined
                ? `Expires at ledger ${request.intent.expiresAtLedger}`
                : expired
                  ? 'This request has expired'
                  : `${remaining} ledgers left (about ${Math.max(1, Math.round((remaining * 5) / 60))} min)`}
          </Text>
        </View>
      </SurfaceCard>
      {status}
      <Button onPress={onPreview}>Preview customer view</Button>
      <Button tone="ghost" onPress={onReset} testID="new-request">New request</Button>
    </>
  );
}

const styles = StyleSheet.create({
  centered: {justifyContent: 'center'},
  heading: {alignItems: 'center', gap: spacing.xs},
  merchantIcon: {alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.round, height: 44, justifyContent: 'center', marginBottom: spacing.sm, width: 44},
  eyebrow: {...typography.label, color: colors.amber, fontSize: 10, letterSpacing: 1.2, textAlign: 'center'},
  title: {...typography.title, color: colors.ink, fontSize: 26},
  subtitle: {color: colors.inkMuted, fontSize: 13, lineHeight: 19, textAlign: 'center'},
  form: {gap: spacing.lg},
  requestCard: {gap: spacing.md, marginTop: spacing.sm},
  requestHeader: {alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between'},
  amount: {color: colors.ink, fontSize: 28, fontWeight: '700'},
  asset: {color: colors.amber, fontSize: 15},
  reference: {color: colors.inkMuted, fontSize: 12, marginTop: spacing.xs},
  nfcRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  nfcText: {fontSize: 13, color: colors.inkMuted},
  qr: {alignItems: 'center', alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: radius.sm, padding: spacing.lg},
  expiry: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  ledgerRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  dot: {backgroundColor: colors.amber, borderRadius: radius.round, height: 8, width: 8},
  dotError: {backgroundColor: colors.danger},
  dotDone: {backgroundColor: colors.success},
  expiryText: {...typography.label, color: colors.inkMuted},
  ledgerText: {color: colors.inkMuted, flex: 1, fontSize: 12, lineHeight: 17},
  error: {...typography.label, color: colors.danger},
  warning: {gap: spacing.sm},
  warningTitle: {...typography.label, color: colors.amber},
  warningBody: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  statusCard: {gap: spacing.sm},
  statusRow: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  statusLabel: {...typography.label, color: colors.inkMuted, fontSize: 11, letterSpacing: 0.9},
  statusBody: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
});
