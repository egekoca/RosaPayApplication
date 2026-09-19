import {useState, type ReactNode} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Nfc, Store} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, LoadingDots, radius, spacing, StatusPill, Stepper, SurfaceCard, TextField, typography} from '@rosapay/ui';
import {encodePaymentQr, type SignedPaymentIntentV1} from '@rosapay/protocol';
import type {CurrencyPrice} from '@rosapay/anchor';
import type {RootStackParams} from '../../app/navigation';
import {Screen} from '../../shared/Screen';
import {displayAmount, exactAmount} from '../../shared/displayAmount';
import {createRandomBytes} from '../../shared/randomBytes';
import {useStellarHealth} from '../../shared/useStellarHealth';
import {useCurrencyPrices} from '../../shared/useCurrencyPrices';
import {useAppStore} from '../../state/appStore';
import {useNfcBroadcast} from '../payments/useNfc';
import {createSignedPaymentRequest, MerchantProfileError} from './merchantProfile';
import {priceRequest, referenceForRequest} from './pricedRequest';
import {defaultPayableAsset, payableAssets, type PayableAsset} from '../payments/assets';
import {useRecipientCanReceive} from './useRecipientCanReceive';
import {registerMerchantForTestnet} from './merchantRegistration';
import {publishPaymentRequest, useRelayerIdentity, usePaymentRequestStatus} from './merchantRequestStatus';
import {useMerchantCountersigning} from './merchantCountersigning';

type Props = NativeStackScreenProps<RootStackParams, 'MerchantRequest'>;

// Nothing insecure may sign a real payment, so there is no fallback to allow.
const randomBytes = createRandomBytes({allowInsecureFallback: false});

export function MerchantRequestScreen({navigation}: Props) {
  const {
    merchantProfile,
    pendingRequest,
    setPendingRequest,
    merchantRegisteredOnChain,
    setMerchantRegisteredOnChain,
  } = useAppStore();
  const stellarHealth = useStellarHealth();
  const settlement = usePaymentRequestStatus(
    pendingRequest?.intent.intentId ?? '',
  );
  const relayer = useRelayerIdentity();
  // A customer on another phone cannot produce the merchant's signature, so this
  // device signs for them as soon as they claim the request.
  useMerchantCountersigning({
    request: pendingRequest,
    profile: merchantProfile,
    relayerAddress: relayer.data?.address,
    settlementContractId: relayer.data?.settlementContractId,
    enabled: settlement.data?.status === 'awaiting_approval',
  });
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  // Which money the merchant is naming the price in. `undefined` means the
  // asset itself, which is the only option until an anchor answers.
  const [currency, setCurrency] = useState<CurrencyPrice | undefined>();
  // What actually moves on chain. The contract refuses anything it was not
  // told about, so this list is the registered one rather than a free choice.
  const [payable, setPayable] = useState<PayableAsset>(defaultPayableAsset);
  const currencies = useCurrencyPrices(payable.sep38);
  const canReceive = useRecipientCanReceive(merchantProfile?.recipient, payable);
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

  /**
   * What the customer will actually be asked to send.
   *
   * A price named in lira has to become an amount of the asset before it is
   * signed, because the asset is what the contract moves. The rate is the
   * anchor's; when it will not quote, the currency is not offered at all.
   */
  const priced = priceRequest({amount, currency});

  const createRequest = () => {
    setError(undefined);
    if (canReceive.data === false) {
      // Signing a request the recipient cannot be paid on would hand the
      // customer something guaranteed to fail after they had approved it.
      setError(`This business cannot receive ${payable.code} yet`);
      return;
    }
    if (currency && !priced) {
      setError(`Enter a price in ${currency.currency} to convert`);
      return;
    }
    try {
      const request = createSignedPaymentRequest(
        merchantProfile,
        {
          amount: priced ? priced.assetAmount : amount,
          reference: referenceForRequest(reference, priced),
          latestLedger: stellarHealth.data?.latestLedger,
          asset: payable.asset,
        },
        randomBytes,
      );
      setPendingRequest(request);
      // Testnet payments settle against an intent the API already knows about.
      void publishPaymentRequest(request).catch(failure => {
        setError(failure instanceof Error ? failure.message : 'The request could not be published to the API');
      });
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
      <AnimatedContent>
        <View style={styles.heading}>
          <View style={styles.merchantIcon}><Store color={colors.goldBright} size={22} /></View>
          <Text style={styles.eyebrow}>{merchantProfile.displayName.toUpperCase()}</Text>
          <Text style={styles.title}>Payment request</Text>
          <Text style={styles.subtitle}>
            {pendingRequest ? 'Show this code to your customer' : 'Enter what the customer owes'}
          </Text>
        </View>
      </AnimatedContent>

      {!merchantRegisteredOnChain ? (
        <AnimatedContent delay={70}>
          <SurfaceCard accent="amber" style={styles.warning}>
            <Text style={styles.warningTitle}>Not registered on Testnet</Text>
            <Text style={styles.warningBody}>
              The settlement contract only accepts requests from a registered merchant key.
            </Text>
            <Button loading={registering} tone="ghost" onPress={() => void registerOnChain()} testID="register-merchant">
              {registering ? 'Registering' : 'Register this business'}
            </Button>
          </SurfaceCard>
        </AnimatedContent>
      ) : null}

      {pendingRequest ? (
        <AnimatedContent delay={110} scaleFrom={0.985}>
          <RequestCard
            request={pendingRequest}
            latestLedger={stellarHealth.data?.latestLedger}
            onReset={() => setPendingRequest(null)}
            onPreview={() => navigation.navigate('Confirm', {payload: pendingRequest})}
            settlementStatus={settlement.data?.status}
            status={<RequestStatus intentId={pendingRequest.intent.intentId} />}
          />
        </AnimatedContent>
      ) : (
        <>
          <AnimatedContent delay={110} scaleFrom={0.985}>
            <SurfaceCard accent="amber" style={styles.form}>
              <Text style={styles.fieldLabel}>PAID IN</Text>
              <View style={styles.currencyRow}>
                {payableAssets.map(option => (
                  <CurrencyPill
                    key={option.code}
                    label={option.code}
                    selected={payable.code === option.code}
                    onPress={() => {
                      setPayable(option);
                      // The old rate was quoted against the old asset.
                      setCurrency(undefined);
                    }}
                  />
                ))}
              </View>
              <Text style={styles.assetNote}>
                {canReceive.data === false
                  ? `${merchantProfile.recipient.slice(0, 4)}…${merchantProfile.recipient.slice(-4)} has no ${payable.code} trustline, so a payment in it would not arrive. Add one, or receive into this phone instead.`
                  : payable.note}
              </Text>

              {currencies.data && currencies.data.length > 0 ? (
                <Text style={styles.fieldLabel}>PRICED IN</Text>
              ) : null}
              {currencies.data && currencies.data.length > 0 ? (
                <View style={styles.currencyRow}>
                  <CurrencyPill
                    label={payable.code}
                    selected={currency === undefined}
                    onPress={() => setCurrency(undefined)}
                  />
                  {currencies.data.slice(0, 3).map(price => (
                    <CurrencyPill
                      key={price.asset}
                      label={price.currency}
                      selected={currency?.asset === price.asset}
                      onPress={() => setCurrency(price)}
                    />
                  ))}
                </View>
              ) : null}
              <TextField
                keyboardType="decimal-pad"
                label={`AMOUNT (${currency?.currency ?? payable.code})`}
                maxLength={20}
                onChangeText={setAmount}
                placeholder={currency ? '500' : '24.5'}
                testID="request-amount"
                value={amount}
              />
              {currency ? (
                <Text style={styles.conversion} testID="request-conversion">
                  {priced
                    ? `Customer sends ${displayAmount(priced.assetAmount)} ${payable.code} · ${displayAmount(currency.perUnit)} ${currency.currency} per ${payable.code}`
                    : `Rate ${displayAmount(currency.perUnit)} ${currency.currency} per ${payable.code}`}
                </Text>
              ) : null}
              <TextField
                label="REFERENCE"
                maxLength={120}
                onChangeText={setReference}
                placeholder="Table 08"
                testID="request-reference"
                value={reference}
              />
            </SurfaceCard>
          </AnimatedContent>
          <AnimatedContent delay={180}>
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
          </AnimatedContent>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <AnimatedContent delay={230}>
            <Button
              disabled={canReceive.data === false}
              onPress={createRequest}
              testID="create-request">
              Create payment request
            </Button>
          </AnimatedContent>
        </>
      )}
    </Screen>
  );
}

/**
 * One currency a merchant can price in.
 *
 * The flag carries the money the fiat currencies name, because a merchant
 * picking one is picking the money on their own menu and reads it faster than
 * a three-letter code. Assets get no flag: USDC and lumens belong to no
 * country, and inventing one for them would say something untrue.
 */
function CurrencyPill({label, selected, onPress}: {label: string; selected: boolean; onPress(): void}) {
  const flag = FLAGS[label];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      style={[styles.pill, selected && styles.pillSelected]}
      testID={`currency-${label}`}>
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
        {flag ? `${flag}  ${label}` : label}
      </Text>
    </Pressable>
  );
}

const FLAGS: Record<string, string | undefined> = {
  TRY: '🇹🇷',
  USD: '🇺🇸',
  NGN: '🇳🇬',
  EUR: '🇪🇺',
  CAD: '🇨🇦',
  GBP: '🇬🇧',
};

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
      {status.isPending ? (
        <View style={styles.statusLoading}>
          <Text style={styles.statusLoadingText}>Refreshing status...</Text>
          <LoadingDots color={colors.goldBright} size={4} />
        </View>
      ) : null}
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
          <View style={styles.requestHeadline}>
            <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.amount}>{exactAmount(request.intent.amount)} <Text style={styles.asset}>{request.intent.asset.code}</Text></Text>
            <Text style={styles.reference}>{request.intent.reference}</Text>
          </View>
          <StatusPill tone={settled ? (settlementStatus === 'confirmed' ? 'success' : 'pending') : expired ? 'danger' : 'pending'}>
            {settled ? settlementStatus!.replace(/_/g, ' ').toUpperCase() : expired ? 'EXPIRED' : 'PENDING'}
          </StatusPill>
        </View>
        <Stepper
          activeIndex={settlementStatus === 'confirmed' ? 2 : 1}
          failed={settlementStatus === 'failed' || settlementStatus === 'rejected'}
          steps={requestSteps}
        />
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

const requestSteps = [
  {key: 'price', label: 'Price'},
  {key: 'show', label: 'Show QR'},
  {key: 'paid', label: 'Paid'},
] as const;

const styles = StyleSheet.create({
  centered: {justifyContent: 'center'},
  heading: {alignItems: 'center', gap: spacing.xs},
  merchantIcon: {alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.goldDeep, borderRadius: radius.round, borderWidth: 1, height: 44, justifyContent: 'center', marginBottom: spacing.sm, width: 44},
  eyebrow: {...typography.overline, color: colors.goldBright, fontSize: 9, letterSpacing: 1.5, textAlign: 'center'},
  title: {...typography.title, color: colors.ink, fontSize: 26},
  subtitle: {color: colors.inkMuted, fontSize: 13, lineHeight: 19, textAlign: 'center'},
  form: {gap: spacing.lg},
  requestCard: {gap: spacing.lg, marginTop: spacing.sm},
  requestHeader: {alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between'},
  requestHeadline: {flexShrink: 1},
  amount: {color: colors.ink, fontSize: 28, fontWeight: '700'},
  currencyRow: {flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs},
  fieldLabel: {...typography.label, color: colors.inkMuted, marginBottom: spacing.xs},
  assetNote: {color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginBottom: spacing.md},
  pill: {borderColor: colors.line, borderRadius: radius.round, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.xs},
  pillSelected: {backgroundColor: colors.gold, borderColor: colors.gold},
  pillText: {color: colors.inkMuted, fontSize: 13, fontWeight: '600'},
  pillTextSelected: {color: colors.ink},
  conversion: {color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs},
  asset: {color: colors.goldBright, fontSize: 15},
  reference: {color: colors.inkMuted, fontSize: 12, marginTop: spacing.xs},
  nfcRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  nfcText: {fontSize: 13, color: colors.inkMuted},
  qr: {alignItems: 'center', alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: radius.sm, padding: spacing.lg},
  expiry: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  ledgerRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  dot: {backgroundColor: colors.gold, borderRadius: radius.round, height: 8, width: 8},
  dotError: {backgroundColor: colors.danger},
  dotDone: {backgroundColor: colors.success},
  expiryText: {...typography.label, color: colors.inkMuted},
  ledgerText: {color: colors.inkMuted, flex: 1, fontSize: 12, lineHeight: 17},
  error: {...typography.label, color: colors.danger},
  warning: {gap: spacing.sm},
  warningTitle: {...typography.label, color: colors.goldBright},
  warningBody: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  statusCard: {gap: spacing.sm},
  statusRow: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  statusLabel: {...typography.label, color: colors.inkMuted, fontSize: 11, letterSpacing: 0.9},
  statusBody: {color: colors.inkMuted, fontSize: 12, lineHeight: 17},
  statusLoading: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  statusLoadingText: {...typography.mono, color: colors.goldBright, fontSize: 10},
});
