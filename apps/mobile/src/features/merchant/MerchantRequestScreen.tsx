import {useEffect, useState, type ReactNode} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Bluetooth, Nfc, RefreshCw, Store} from 'lucide-react-native';
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
import {OptionField, OptionSheet, type SheetOption} from '../../shared/OptionSheet';
import {displayCurrencyMeta} from '../../shared/priceSource';
import {useAppStore} from '../../state/appStore';
import {useNfcBroadcast} from '../payments/useNfc';
import {useProximityBroadcast} from '../payments/useProximity';
import {businessEmailSchema, createSignedPaymentRequest, MerchantProfileError} from './merchantProfile';
import {isOfferable} from './paymentOutcome';
import {priceRequest, referenceForRequest} from './pricedRequest';
import {defaultPayableAsset, payableAssets, type PayableAsset} from '../payments/assets';
import {useRecipientCanReceive} from './useRecipientCanReceive';
import {registerMerchantForTestnet} from './merchantRegistration';
import {publishPaymentRequest, useRelayerIdentity, usePaymentRequestStatus} from './merchantRequestStatus';
import {useMerchantCountersigning} from './merchantCountersigning';
import {useTranslate} from '../../shared/i18n';

type Props = NativeStackScreenProps<RootStackParams, 'MerchantRequest'>;
type PublicationState =
  | {intentId: string; status: 'publishing' | 'published'}
  | {intentId: string; status: 'failed'; error: string}
  | null;

// Nothing insecure may sign a real payment, so there is no fallback to allow.
const randomBytes = createRandomBytes({allowInsecureFallback: false});

export function MerchantRequestScreen({navigation, route}: Props) {
  const t = useTranslate();
  const {
    merchantProfile,
    pendingRequest,
    setPendingRequest,
    merchantRegisteredOnChain,
    setMerchantRegisteredOnChain,
  } = useAppStore();
  const stellarHealth = useStellarHealth();
  const [publishAttempt, setPublishAttempt] = useState(0);
  const [publication, setPublication] = useState<PublicationState>(null);
  useEffect(() => {
    if (!pendingRequest || !merchantProfile || !merchantRegisteredOnChain) {
      setPublication(null);
      return;
    }

    let active = true;
    const intentId = pendingRequest.intent.intentId;
    setPublication({intentId, status: 'publishing'});
    void publishPaymentRequest(pendingRequest)
      .then(() => {
        if (active) setPublication({intentId, status: 'published'});
      })
      .catch(failure => {
        if (active) {
          setPublication({
            intentId,
            status: 'failed',
            error: failure instanceof Error ? failure.message : 'The request could not be published to the API',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [merchantProfile, merchantRegisteredOnChain, pendingRequest, publishAttempt]);
  const requestPublication = pendingRequest && publication?.intentId === pendingRequest.intent.intentId
    ? publication
    : null;
  const published = merchantRegisteredOnChain && requestPublication?.status === 'published';
  const publishing = Boolean(
    pendingRequest && merchantRegisteredOnChain &&
    (!requestPublication || requestPublication.status === 'publishing'),
  );
  const settlement = usePaymentRequestStatus(published ? pendingRequest!.intent.intentId : '');

  /**
   * A request nobody can pay any more is not the counter's active request.
   *
   * It used to hold the slot regardless: the home screen kept offering to
   * "open the active request", this screen kept drawing a dead card, and the
   * only way to take the next payment was to find "New request" underneath it.
   * A merchant standing in front of a customer should not have to.
   */
  const pendingLedger = stellarHealth.data?.latestLedger;
  const pendingExpired = Boolean(
    pendingRequest &&
      pendingLedger !== undefined &&
      pendingRequest.intent.expiresAtLedger <= pendingLedger,
  );
  useEffect(() => {
    // Cleared from the store, not just hidden, so the home screen stops
    // offering it too. Its history lives on the API and in Recent payments.
    if (pendingExpired) setPendingRequest(null);
  }, [pendingExpired, setPendingRequest]);
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
  const [pickingUnit, setPickingUnit] = useState(false);
  const currencies = useCurrencyPrices(payable.sep38);
  const canReceive = useRecipientCanReceive(merchantProfile?.recipient, payable);
  const [error, setError] = useState<string | undefined>();
  // Kept apart from `error` so it can be shown beside the retry it belongs to.
  // Registration fails at the top of this screen; the shared error line sits
  // below the whole pricing form, off the bottom of the phone, where the reason
  // a merchant cannot be paid is the last thing they would ever scroll to.
  const [registerError, setRegisterError] = useState<string | undefined>(route.params?.registrationError);
  const [registering, setRegistering] = useState(false);

  if (!merchantProfile || !businessEmailSchema.safeParse(merchantProfile.email).success) {
    return (
      <Screen contentStyle={styles.centered}>
        <Text style={styles.subtitle}>{t('Set up your business profile before creating a payment request.')}</Text>
        <Button onPress={() => navigation.replace('MerchantOnboarding')}>{t('Set up business')}</Button>
      </Screen>
    );
  }

  const registerOnChain = async () => {
    if (!merchantProfile) return;
    setRegisterError(undefined);
    setRegistering(true);
    try {
      await registerMerchantForTestnet(merchantProfile);
      setMerchantRegisteredOnChain(true);
    } catch (failure) {
      setRegisterError(failure instanceof Error ? failure.message : t('Testnet registration failed'));
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

  /*
   * One control for the money the price is named in, whether that is an asset
   * this deployment settles or a currency something will quote.
   *
   * These used to be two rows of pills — the asset, then the currency — and the
   * currency row was cut to the first three, so a merchant who wanted the
   * fourth had no way to reach it and no way to know it was there. They are one
   * list now because to a merchant they are one question: what am I typing this
   * price in? Picking an asset answers both halves at once, since a price named
   * in USDC is paid in USDC.
   */
  const unitOptions: SheetOption[] = [
    ...payableAssets.map(option => ({
      value: `asset:${option.code}`,
      label: option.code,
      detail: option.name,
      glyph: '◈',
    })),
    ...(currencies.data ?? []).map(price => ({
      value: `fiat:${price.asset}`,
      label: price.currency,
      detail: `${displayAmount(price.perUnit)} ${price.currency} ${t('per')} ${payable.code}`,
      glyph: displayCurrencyMeta(price.currency).flag,
    })),
  ];
  const selectedUnit = currency ? `fiat:${currency.asset}` : `asset:${payable.code}`;
  const selectedUnitLabel = currency?.currency ?? payable.code;

  const chooseUnit = (value: string) => {
    if (value.startsWith('asset:')) {
      const code = value.slice('asset:'.length);
      const option = payableAssets.find(entry => entry.code === code);
      if (!option) return;
      setPayable(option);
      // Pricing in the asset means there is no conversion to hold.
      setCurrency(undefined);
      return;
    }
    const asset = value.slice('fiat:'.length);
    const price = (currencies.data ?? []).find(entry => entry.asset === asset);
    // A currency whose quote has since gone is not selectable: converting with
    // a rate nothing stands behind is how a merchant is paid the wrong amount.
    if (price) setCurrency(price);
  };

  const createRequest = () => {
    setError(undefined);
    if (!merchantRegisteredOnChain) {
      setError(t('Register this business before creating a payment request'));
      return;
    }
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
          // Nothing typed means the request names the amount being asked for.
          reference: referenceForRequest(
            reference,
            priced,
            `${priced ? priced.assetAmount : amount.trim()} ${payable.code}`,
          ),
          latestLedger: stellarHealth.data?.latestLedger,
          asset: payable.asset,
        },
        randomBytes,
      );
      setPendingRequest(request);
    } catch (failure) {
      setError(
        failure instanceof MerchantProfileError || failure instanceof Error
          ? failure.message
          : t('The payment request could not be created'),
      );
    }
  };

  return (
    <Screen>
      <AnimatedContent>
        <View style={styles.heading}>
          <View style={styles.merchantIcon}><Store color={colors.goldBright} size={22} /></View>
          <Text style={styles.eyebrow}>{merchantProfile.displayName.toUpperCase()}</Text>
          <Text style={styles.title}>{t('Payment request')}</Text>
          <Text style={styles.subtitle}>
            {pendingRequest
              ? published ? t('Show this code to your customer') : t('Preparing payment request')
              : t('Enter what the customer owes')}
          </Text>
        </View>
      </AnimatedContent>

      {!merchantRegisteredOnChain ? (
        <AnimatedContent delay={70}>
          <SurfaceCard accent="amber" style={styles.warning}>
            <Text style={styles.warningTitle}>{t('Not registered on Testnet')}</Text>
            <Text style={styles.warningBody}>{t('The settlement contract only accepts requests from a registered merchant key.')}</Text>
            {registerError ? <Text style={styles.error} testID="register-merchant-error">{registerError}</Text> : null}
            <Button loading={registering} tone="ghost" onPress={() => void registerOnChain()} testID="register-merchant">
              {registering ? t('Registering') : t('Register this business')}
            </Button>
          </SurfaceCard>
        </AnimatedContent>
      ) : null}

      {pendingRequest ? (
        <AnimatedContent delay={110} scaleFrom={0.985}>
          <RequestCard
            request={pendingRequest}
            latestLedger={stellarHealth.data?.latestLedger}
            ledgerUnavailable={stellarHealth.isError}
            published={published}
            publishing={publishing}
            publishError={requestPublication?.status === 'failed' ? requestPublication.error : undefined}
            onRetryPublish={() => setPublishAttempt(value => value + 1)}
            onReset={() => setPendingRequest(null)}
            onPreview={() => navigation.navigate('Confirm', {payload: pendingRequest})}
            settlementStatus={published ? settlement.data?.status : undefined}
            status={published ? <RequestStatus intentId={pendingRequest.intent.intentId} /> : undefined}
          />
        </AnimatedContent>
      ) : (
        <>
          <AnimatedContent delay={110} scaleFrom={0.985}>
            <SurfaceCard accent="amber" style={styles.form}>
              <OptionField
                label={t('PRICE IN')}
                onPress={() => setPickingUnit(true)}
                testID="request-unit"
                value={selectedUnitLabel}
                {...(currency ? {glyph: displayCurrencyMeta(currency.currency).flag} : {glyph: '◈'})}
              />

              {/*
                Only asked when it still needs asking. A price named in an asset
                is paid in that asset; a price named in lira could be settled in
                either, and nothing but the merchant can decide which.
              */}
              {currency ? (
                <>
                  <Text style={styles.fieldLabel}>{t('CUSTOMER SENDS')}</Text>
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
                </>
              ) : null}

              <Text style={styles.assetNote}>
                {canReceive.data === false
                  ? `${merchantProfile.recipient.slice(0, 4)}…${merchantProfile.recipient.slice(-4)} ${t('has no')} ${payable.code} ${t('trustline, so a payment in it would not arrive. Add one, or receive into this phone instead.')}`
                  : payable.note}
              </Text>
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
                    ? `${t('Customer sends')} ${displayAmount(priced.assetAmount)} ${payable.code} · ${displayAmount(currency.perUnit)} ${currency.currency} ${t('per')} ${payable.code}`
                    : `${t('Rate')} ${displayAmount(currency.perUnit)} ${currency.currency} ${t('per')} ${payable.code}`}
                </Text>
              ) : null}
              {/*
                Optional, and labelled so. A counter that has a table number
                puts it here; one that does not is not made to invent one, and
                the request then names the amount it is asking for.
              */}
              <TextField
                label={t('REFERENCE (OPTIONAL)')}
                maxLength={120}
                onChangeText={setReference}
                placeholder={t('Table 08, order number, anything')}
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
                  ? t('Reading the Testnet ledger')
                  : stellarHealth.isError
                    ? t('Testnet unavailable, so an expiry cannot be set')
                    : `${t('Expires about 5 minutes after ledger')} ${stellarHealth.data?.latestLedger}`}
              </Text>
            </View>
          </AnimatedContent>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <AnimatedContent delay={230}>
            <Button
              disabled={!merchantRegisteredOnChain || canReceive.data === false || stellarHealth.isPending || stellarHealth.isError}
              onPress={createRequest}
              testID="create-request">{t('Create payment request')}</Button>
          </AnimatedContent>
          <OptionSheet
            onClose={() => setPickingUnit(false)}
            onSelect={chooseUnit}
            options={unitOptions}
            selected={selectedUnit}
            testIDPrefix="request-unit"
            title={t('Name this price in')}
            visible={pickingUnit}
          />
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
  const t = useTranslate();
  const status = usePaymentRequestStatus(intentId);
  const settlement = status.data;
  const tone = settlement?.status === 'confirmed' ? 'success' : settlement?.status === 'failed' ? 'danger' : 'pending';

  return (
    <SurfaceCard style={styles.statusCard}>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>{t('PAYMENT STATUS')}</Text>
        <StatusPill tone={tone}>{statusLabel(settlement?.status ?? (status.isPending ? 'checking' : 'unknown'), t)}</StatusPill>
      </View>
      <Text style={styles.statusBody}>
        {settlement?.status === 'confirmed'
          ? `${t('Settled in ledger')} ${settlement.ledger} · ${settlement.transactionHash?.slice(0, 16)}…`
          : settlement?.status === 'submitted'
            ? t('Sent to Stellar, waiting for the ledger to confirm it.')
            : settlement?.status === 'authorized'
              ? t('The customer authorized this payment.')
              : settlement?.status === 'failed'
                ? `${t('Settlement failed:')} ${settlement.failureCode ?? t('unknown reason')}`
                : status.isError
                  ? t('The API could not be reached, so the status is unknown here.')
                  : t('Waiting for a customer to pay this request.')}
      </Text>
      {status.isPending ? (
        <View style={styles.statusLoading}>
          <Text style={styles.statusLoadingText}>{t('Refreshing status...')}</Text>
          <LoadingDots color={colors.goldBright} size={4} />
        </View>
      ) : null}
    </SurfaceCard>
  );
}

function RequestCard({
  request,
  latestLedger,
  ledgerUnavailable,
  published,
  publishing,
  publishError,
  onRetryPublish,
  onReset,
  onPreview,
  status,
  settlementStatus,
}: {
  request: SignedPaymentIntentV1;
  latestLedger: number | undefined;
  ledgerUnavailable: boolean;
  published: boolean;
  publishing: boolean;
  publishError: string | undefined;
  onRetryPublish: () => void;
  onReset: () => void;
  onPreview: () => void;
  status?: ReactNode;
  settlementStatus?: string;
}) {
  const t = useTranslate();
  const remaining = latestLedger === undefined ? undefined : request.intent.expiresAtLedger - latestLedger;
  // Once a payment has moved, its outcome is what matters; the expiry window
  // only describes a request that is still waiting for a customer.
  const closed = settlementStatus !== undefined && settlementStatus !== 'awaiting_approval';
  const expired = !closed && remaining !== undefined && remaining <= 0;
  // A request must have a fresh ledger observation before it is shown or
  // broadcast. If the merchant loses Testnet connectivity, keeping an old QR
  // or HCE payload visible would invite a customer to tap a request whose
  // five-minute window can no longer be verified locally.
  const requestLive =
    published &&
    isOfferable(settlementStatus ?? '') &&
    !ledgerUnavailable &&
    latestLedger !== undefined &&
    remaining !== undefined &&
    remaining > 0 &&
    !closed &&
    !expired;
  const encoded = encodePaymentQr(request);
  // Do not offer a request until the API knows it, or after its one payment.
  const offered = requestLive ? encoded : null;
  const nfc = useNfcBroadcast(offered);
  // Both radios carry the same bytes, and a counter does not know what the
  // customer walking up is holding. NFC is the better tap where both phones are
  // Android; Bluetooth is what lets an iPhone customer — or an iPhone running
  // this very screen — take part at all, since iOS grants no card emulation.
  const proximity = useProximityBroadcast(offered);
  return (
    <>
      <SurfaceCard style={styles.requestCard}>
        <View style={styles.requestHeader}>
          <View style={styles.requestHeadline}>
            <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.amount}>{exactAmount(request.intent.amount)} <Text style={styles.asset}>{request.intent.asset.code}</Text></Text>
            <Text style={styles.reference}>{request.intent.reference}</Text>
          </View>
          <StatusPill tone={closed ? (settlementStatus === 'confirmed' ? 'success' : settlementStatus === 'failed' || settlementStatus === 'rejected' ? 'danger' : 'pending') : expired ? 'danger' : 'pending'}>
            {closed ? statusLabel(settlementStatus!, t) : expired ? t('EXPIRED') : publishing ? t('PUBLISHING') : settlementStatus === 'awaiting_approval' ? t('PENDING') : t('Checking')}
          </StatusPill>
        </View>
        <Stepper
          activeIndex={settlementStatus === 'confirmed' ? 2 : 1}
          failed={settlementStatus === 'failed' || settlementStatus === 'rejected'}
          steps={requestSteps.map(step => ({...step, label: t(step.label)}))}
        />
        {requestLive ? (
          <View style={styles.qr} testID="request-qr-ready">
            <QRCode value={encoded} size={214} color={colors.black} backgroundColor="#FFFFFF" />
          </View>
        ) : (
          <View style={styles.qrPlaceholder} testID="request-not-ready">
            {publishing ? <LoadingDots color={colors.goldBright} size={4} /> : null}
            <Text style={styles.qrPlaceholderText}>
              {!published
                ? !publishing && !publishError ? t('Register this business before creating a payment request') : publishError ? t('This request is not published') : t('Publishing payment request')
                : expired ? t('This request has expired') : closed ? t('This payment request is closed') : t('Checking payment request')}
            </Text>
            {publishError ? (
              <>
                <Text style={styles.nfcText}>{t('The API did not confirm the request. Retry before asking a customer to pay.')}</Text>
                <Button
                  icon={<RefreshCw color={colors.black} size={16} />}
                  onPress={onRetryPublish}
                  testID="retry-publish-request"
                  tone="ghost">
                  {t('Retry publish')}
                </Button>
              </>
            ) : null}
          </View>
        )}
        {requestLive ? (
          <ProximityOffer nfc={nfc} proximity={proximity} />
        ) : null}
        <View style={styles.expiry}>
          <View style={[styles.dot, expired && styles.dotError, settlementStatus === 'confirmed' && styles.dotDone]} />
          <Text style={styles.expiryText}>
            {settlementStatus === 'confirmed'
              ? t('A customer has paid this request')
              : closed
                ? t('This payment request is closed')
              : remaining === undefined
                ? `${t('Expires at ledger')} ${request.intent.expiresAtLedger}`
                : expired
                  ? t('This request has expired')
                  : `${remaining} ${t('ledgers left')} (${t('about')} ${Math.max(1, Math.round((remaining * 5) / 60))} ${t('min')})`}
          </Text>
        </View>
      </SurfaceCard>
      {status}
      {requestLive ? <Button onPress={onPreview}>{t('Preview customer view')}</Button> : null}
      <Button tone="ghost" onPress={onReset} testID="new-request">{t('New request')}</Button>
    </>
  );
}

/**
 * One line for the radios, because to a merchant they are one fact: whether a
 * customer can be served without pointing a camera at the counter. Two rows
 * saying "let them tap" and "let them hold their phone here" described an
 * implementation split, not anything happening on the counter.
 */
export type ProximityOfferState =
  | {kind: 'hidden'}
  | {kind: 'live'; bluetooth: boolean}
  | {kind: 'preparing'; bluetooth: boolean}
  | {kind: 'needs-bluetooth'}
  | {kind: 'bluetooth-off'}
  | {kind: 'failed'; bluetooth: boolean};

/**
 * What the counter should say about being approached rather than scanned.
 *
 * Bluetooth outranks NFC in this message even when both are on the air, because
 * it is the half that reaches every customer: an iPhone merchant has no NFC to
 * offer, and an iPhone customer cannot be made to tap silently. A merchant who
 * has not granted it is told so rather than quietly serving Android alone.
 */
export function proximityOfferState(input: {
  nfc: {canBroadcast: boolean; enabled: boolean; broadcasting: boolean; broadcastError?: string};
  proximity: {
    supported: boolean;
    canBroadcast: boolean;
    enabled: boolean;
    authorized: boolean;
    broadcasting: boolean;
    broadcastError?: string;
  };
}): ProximityOfferState {
  const {nfc, proximity} = input;
  const nfcUsable = nfc.canBroadcast && nfc.enabled;
  const bluetoothUsable = proximity.canBroadcast && proximity.authorized && proximity.enabled;

  if (bluetoothUsable && proximity.broadcasting) return {kind: 'live', bluetooth: true};
  // Before falling back to "NFC is on the air", because NFC being on the air is
  // exactly when a merchant would otherwise believe the counter was ready. An
  // Android tap serves Android customers; an iPhone customer needs the half
  // that has not been switched on.
  if (proximity.supported && !proximity.authorized) return {kind: 'needs-bluetooth'};
  if (proximity.supported && !proximity.enabled) return {kind: 'bluetooth-off'};
  if (nfcUsable && nfc.broadcasting) return {kind: 'live', bluetooth: false};
  if (proximity.broadcastError) return {kind: 'failed', bluetooth: true};
  if (nfc.broadcastError) return {kind: 'failed', bluetooth: false};
  if (bluetoothUsable) return {kind: 'preparing', bluetooth: true};
  if (nfcUsable) return {kind: 'preparing', bluetooth: false};
  return {kind: 'hidden'};
}

/**
 * One line for the radios, because to a merchant they are one fact: whether a
 * customer can be served without pointing a camera at the counter. Two rows
 * saying "let them tap" and "let them hold their phone here" described an
 * implementation split, not anything happening on the counter.
 */
function ProximityOffer({
  nfc,
  proximity,
}: {
  nfc: ReturnType<typeof useNfcBroadcast>;
  proximity: ReturnType<typeof useProximityBroadcast>;
}) {
  const t = useTranslate();
  const state = proximityOfferState({nfc, proximity});
  if (state.kind === 'hidden') return null;

  const bluetooth = state.kind === 'needs-bluetooth' || state.kind === 'bluetooth-off' || state.bluetooth;
  return (
    <View style={styles.nfcRow} testID={`proximity-${state.kind}`}>
      {bluetooth ? <Bluetooth color={colors.amber} size={18} /> : <Nfc color={colors.amber} size={18} />}
      <Text style={styles.nfcText}>
        {state.kind === 'live'
          ? t('Or let the customer hold their phone against this one')
          : state.kind === 'needs-bluetooth'
            ? t('Allow Bluetooth so an iPhone customer can pay by holding their phone here')
            : state.kind === 'bluetooth-off'
              ? t('Turn on Bluetooth so an iPhone customer can pay by holding their phone here')
              : state.kind === 'failed'
                ? t('Holding phones together is unavailable right now; use the QR code')
                : t('Preparing to be tapped')}
      </Text>
      {state.kind === 'needs-bluetooth' ? (
        <Button onPress={proximity.request} testID="allow-proximity-broadcast" tone="ghost">
          {t('Allow Bluetooth')}
        </Button>
      ) : state.kind === 'failed' ? (
        <Button
          icon={<RefreshCw color={colors.black} size={16} />}
          onPress={() => {
            if (proximity.broadcastError) proximity.retry();
            if (nfc.broadcastError) nfc.retry();
          }}
          testID="retry-proximity-broadcast"
          tone="ghost">
          {t('Retry')}
        </Button>
      ) : null}
    </View>
  );
}

const requestSteps = [
  {key: 'price', label: 'Price'},
  {key: 'show', label: 'Show QR'},
  {key: 'paid', label: 'Paid'},
] as const;

function statusLabel(status: string, t: (text: string) => string): string {
  const key = status.replace(/_/g, ' ');
  const labels: Record<string, string> = {
    checking: t('Checking'),
    unknown: t('Unknown'),
    awaiting_approval: t('AWAITING APPROVAL'),
    confirmed: t('CONFIRMED'),
    submitted: t('SUBMITTED'),
    authorized: t('AUTHORIZED'),
    failed: t('FAILED'),
    rejected: t('REJECTED'),
  };
  return labels[status] ?? key.toUpperCase();
}

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
  qrPlaceholder: {alignItems: 'center', alignSelf: 'center', gap: spacing.sm, justifyContent: 'center', minHeight: 246, padding: spacing.lg, width: '100%'},
  qrPlaceholderText: {color: colors.inkMuted, fontSize: 13, lineHeight: 18, textAlign: 'center'},
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
