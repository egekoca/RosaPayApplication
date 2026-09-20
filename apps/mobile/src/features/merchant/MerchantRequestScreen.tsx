import {useEffect, useState, type ReactNode} from 'react';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Bluetooth, Plus, RefreshCw, Store, Timer} from 'lucide-react-native';
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
import {useProximityBroadcast} from '../payments/useProximity';
import {useProximityDiagnostics} from '../payments/useProximityDiagnostics';
import {businessEmailSchema, createSignedPaymentRequest, MerchantProfileError} from './merchantProfile';
import {isOfferable} from './paymentOutcome';
import {priceRequest, referenceForRequest} from './pricedRequest';
import {defaultPayableAsset, payableAssets, type PayableAsset} from '../payments/assets';
import {AssetMark} from '../home/AssetMark';
import {useRecipientCanReceive} from './useRecipientCanReceive';
import {ensureTrustline} from '../wallet/accountSetup';
import {loadSigningKey} from '../wallet/keyVault';
import {keypairFromSecret} from '../wallet/stellarKey';
import {registerMerchantForTestnet} from './merchantRegistration';
import {publishPaymentRequest, useRelayerIdentity, usePaymentRequestStatus} from './merchantRequestStatus';
import {useMerchantCountersigning} from './merchantCountersigning';
import {useOfflineCounter, type OfflineCounterState} from './useOfflineCounter';
import {useTranslate} from '../../shared/i18n';
import {clock, useLedgerCountdown} from '../../shared/ledgerCountdown';

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
    const request = pendingRequest;
    setPublication({intentId, status: 'publishing'});

    /*
     * One retry, for everything except a person saying no.
     *
     * Publishing needs a device session, and minting one asks for Face ID and
     * then calls an API that is asleep between demos — so the first call after
     * a quiet spell can time out on a host that is only waking up. That left a
     * request card with no QR and a button to press, at the counter, with a
     * customer waiting. The second attempt costs nothing: a prompt that
     * succeeded has already stored the session, so it does not ask again.
     *
     * A cancelled or failed prompt is not retried. Nobody wants Face ID twice
     * for a request they have just declined to authorize, and the honest
     * answer there is the button.
     */
    void (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await publishPaymentRequest(request);
          if (active) setPublication({intentId, status: 'published'});
          return;
        } catch (failure) {
          const code = (failure as {code?: string} | null)?.code;
          const refused = code === 'USER_CANCELLED' || code === 'LOCKED_OUT' || code === 'BIOMETRIC_FAILED';
          if (!active) return;
          if (attempt === 0 && !refused) {
            await new Promise(resolve => setTimeout(resolve, 1_200));
            if (!active) return;
            continue;
          }
          setPublication({
            intentId,
            status: 'failed',
            error: refused
              ? 'This phone did not approve the request. Press retry and answer the prompt.'
              : failure instanceof Error
                ? failure.message
                : 'The request could not be published to the API',
          });
          return;
        }
      }
    })();
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
  /**
   * The other way a customer can pay this request: with no network at all.
   *
   * This phone is the online half of that pair, so everything needing a chain
   * happens here — the simulation, the merchant's own contract signature, the
   * submission — and the customer is asked for one signature over the exact
   * invocation that came out of it. It runs beside the online path rather than
   * instead of it: a customer with signal still pays the way they always did.
   */
  const offlineCounter = useOfflineCounter({
    request: pendingRequest,
    profile: merchantProfile,
    relayer: relayer.data,
    latestLedger: stellarHealth.data?.latestLedger,
    enabled: published && (settlement.data === undefined || isOfferable(settlement.data.status)),
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
  const [openingTrustline, setOpeningTrustline] = useState(false);
  // Only an account this phone can sign for can be given a line from here.
  const recipientIsThisWallet = Boolean(
    merchantProfile?.recipient && merchantProfile.recipient === useAppStore.getState().wallet?.address,
  );

  const openTrustline = async () => {
    if (payable.asset.type === 'native' || !payable.asset.issuer) return;
    setOpeningTrustline(true);
    setError(undefined);
    try {
      const secret = await loadSigningKey(`Accept ${payable.code} into this wallet`);
      await ensureTrustline(keypairFromSecret(secret), {
        code: payable.asset.code,
        issuer: payable.asset.issuer,
      });
      await canReceive.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `This wallet could not accept ${payable.code}`);
    } finally {
      setOpeningTrustline(false);
    }
  };

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
      // The real Stellar and Circle marks, the same badge that sits beside the
      // balance the money will arrive in. A diamond stood here for both, which
      // told a merchant nothing on the one screen where the difference between
      // lumens and dollars is the whole decision.
      glyph: <AssetMark code={option.code} size={26} />,
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

      {/*
        Taking the next payment is the thing a merchant came here to do, and
        it sat under the whole of the last one — a card that keeps its full
        detail after it has been paid, so every customer began by scrolling
        past the previous customer to find a ghost button labelled "New
        request". It leads the screen now, above the card rather than below it.
      */}
      {pendingRequest ? (
        <AnimatedContent delay={100}>
          <Button icon={<Plus color={colors.black} size={20} />} onPress={() => setPendingRequest(null)} testID="new-request">
            {t('New payment')}
          </Button>
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
            onPreview={() => navigation.navigate('Confirm', {payload: pendingRequest})}
            settlementStatus={published ? settlement.data?.status : undefined}
            offlineCounter={offlineCounter}
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
                {...(currency
                  ? {glyph: displayCurrencyMeta(currency.currency).flag}
                  : {glyph: <AssetMark code={payable.code} size={24} />})}
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
                        mark
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
              {/*
                A blocked button that explains itself is still a blocked button.
                Asking to be paid in USDC did nothing and said why in a line of
                grey text, when the thing standing in the way is one operation
                on an account this phone holds the key to. Offered only for
                that case — a recipient somewhere else is not ours to change.
              */}
              {canReceive.data === false && recipientIsThisWallet ? (
                <Button
                  loading={openingTrustline}
                  tone="ghost"
                  onPress={() => void openTrustline()}
                  testID="open-trustline">
                  {openingTrustline
                    ? t('Opening')
                    : `${t('Accept')} ${payable.code} ${t('into this wallet')}`}
                </Button>
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
/**
 * A currency or an asset, offered the way its holder already recognises it.
 *
 * Currencies carry their flag. Assets carried nothing at all — a row reading
 * "XLM  USDC" in plain text, on the screen where a merchant decides what they
 * will be handed, which is the one place the difference is worth being sure
 * about. `AssetMark` draws the real Stellar and Circle marks, so the same badge
 * appears here as beside the balance it will arrive in.
 */
function CurrencyPill({
  label,
  selected,
  onPress,
  mark,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
  mark?: boolean;
}) {
  const flag = FLAGS[label];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      style={[styles.pill, selected && styles.pillSelected]}
      testID={`currency-${label}`}>
      {mark ? <AssetMark code={label} size={20} /> : null}
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
  onPreview,
  status,
  settlementStatus,
  offlineCounter,
}: {
  request: SignedPaymentIntentV1;
  latestLedger: number | undefined;
  ledgerUnavailable: boolean;
  published: boolean;
  publishing: boolean;
  publishError: string | undefined;
  onRetryPublish: () => void;
  onPreview: () => void;
  status?: ReactNode;
  settlementStatus?: string;
  offlineCounter: OfflineCounterState;
}) {
  const t = useTranslate();
  const remaining = latestLedger === undefined ? undefined : request.intent.expiresAtLedger - latestLedger;
  const secondsLeft = useLedgerCountdown(remaining);
  /*
   * The width this card actually gives the code, and the box that holds it.
   *
   * Zero until the first layout, which is why the fallback is the size this
   * was fixed at: the first frame looks exactly as it did before and the
   * measurement corrects it, rather than flashing a guess. The white plate is
   * square and both states use it, so nothing on the card moves when the code
   * replaces the message that stood in for it.
   */
  const [qrArea, setQrArea] = useState(0);
  const qrSize = qrArea > 0 ? Math.max(140, Math.min(288, qrArea - QR_PLATE_PADDING * 2)) : 214;
  const qrBox = qrSize + QR_PLATE_PADDING * 2;
  // Once a payment has moved, its outcome is what matters; the expiry window
  // only describes a request that is still waiting for a customer.
  const closed = settlementStatus !== undefined && settlementStatus !== 'awaiting_approval';
  const expired = !closed && remaining !== undefined && remaining <= 0;
  const requestLive = shouldShowRequest({
    published,
    settlementStatus,
    ledgerUnavailable,
    latestLedger,
    expiresAtLedger: request.intent.expiresAtLedger,
  });
  const encoded = encodePaymentQr(request);
  /**
   * An offline payment lives on the advertisement that started it.
   *
   * A customer with no network has no other way back to this phone, and the
   * moment a settlement is recorded the request stops being offerable — which
   * would take the link down while the customer is still waiting to be told
   * what the chain said. So a conversation in progress keeps the radio up,
   * and only a finished one lets it go.
   */
  const settlingOffline =
    offlineCounter.status === 'preparing' ||
    offlineCounter.status === 'awaiting-approval' ||
    offlineCounter.status === 'submitting';
  // Do not offer a request until the API knows it, or after its one payment.
  const offered = requestLive || settlingOffline ? encoded : null;
  // Bluetooth is what lets an iPhone customer — or an iPhone running this very
  // screen — be part of this at all, since iOS grants no card emulation, and it
  // is now the only radio here.
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
        {/*
          Measured rather than calculated. The code has to fit inside a card
          inside a screen, each with its own padding, and at 214 fixed it was
          six points wider than the card on a small phone — and the same 214 on
          a tablet, marooned in white space. Reading the width this view is
          actually given needs none of those numbers repeated here, and cannot
          drift when one of them changes.
        */}
        <View
          onLayout={event => setQrArea(event.nativeEvent.layout.width)}
          style={styles.qrArea}>
          {requestLive ? (
            <>
              {/*
                Above the code, because it is the thing that decides whether the
                code is worth showing to the person in front of you. "52 ledgers
                left" was the truth and answered nobody's question; a clock does.
              */}
              <View style={styles.countdown} testID="request-countdown">
                <Timer color={secondsLeft !== undefined && secondsLeft <= 60 ? colors.danger : colors.amber} size={15} />
                <Text style={[styles.countdownText, secondsLeft !== undefined && secondsLeft <= 60 && styles.countdownUrgent]}>
                  {secondsLeft === undefined ? t('Checking how long this is valid') : `${clock(secondsLeft)} ${t('left to pay')}`}
                </Text>
              </View>
              <View style={[styles.qr, {height: qrBox, width: qrBox}]} testID="request-qr-ready">
                <QRCode value={encoded} size={qrSize} color={colors.black} backgroundColor="#FFFFFF" />
              </View>
            </>
          ) : (
            <View style={[styles.qrPlaceholder, {minHeight: qrBox}]} testID="request-not-ready">
              {publishing ? <LoadingDots color={colors.goldBright} size={4} /> : null}
              <Text style={styles.qrPlaceholderText}>
                {!published
                  ? !publishing && !publishError ? t('Register this business before creating a payment request') : publishError ? t('This request is not published') : t('Publishing payment request')
                  : expired ? t('This request has expired') : closed ? t('This payment request is closed') : t('Checking payment request')}
              </Text>
              {publishError ? (
                <>
                  <Text style={styles.radioText}>{t('The API did not confirm the request. Retry before asking a customer to pay.')}</Text>
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
        </View>
        {requestLive ? (
          <ProximityOffer proximity={proximity} />
        ) : null}
        <OfflineCounterLine state={offlineCounter} />
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
                  : `${remaining} ${t('ledgers left')}`}
          </Text>
        </View>
      </SurfaceCard>
      {status}
      {requestLive ? <Button onPress={onPreview}>{t('Preview customer view')}</Button> : null}
    </>
  );
}

/**
 * What a customer with no network is doing, in one line.
 *
 * Their phone can say almost nothing while this is happening — it has no chain
 * to read — so this screen is where both people find out whether the payment is
 * working. Silent until there is a customer, because a counter with nobody at
 * it should not be explaining a transport.
 */
function OfflineCounterLine({state}: {state: OfflineCounterState}) {
  const t = useTranslate();
  if (state.status === 'idle') return null;

  const tone =
    state.status === 'confirmed' ? colors.success : state.status === 'failed' ? colors.danger : colors.amber;
  const message =
    state.status === 'preparing'
      ? t('A customer is paying without a network. Preparing what their phone must sign.')
      : state.status === 'awaiting-approval'
        ? t('Waiting for the customer to approve on their phone.')
        : state.status === 'submitting'
          ? t('Approved. Submitting it to Stellar and paying the fee.')
          : state.status === 'confirmed'
            ? t('Paid without the customer ever connecting.')
            : state.message;

  return (
    <View style={styles.radioRow} testID="offline-counter">
      <Bluetooth color={tone} size={15} />
      <Text style={[styles.radioText, {color: tone}]}>{message}</Text>
    </View>
  );
}

/**
 * One line for the radio, because to a merchant it is one fact: whether a
 * customer can be served without pointing a camera at the counter. It used to
 * carry which of two radios was speaking, which described an implementation
 * split rather than anything happening on the counter — and there is one now.
 */
export type ProximityOfferState =
  | {kind: 'hidden'}
  | {kind: 'live'}
  | {kind: 'preparing'}
  | {kind: 'needs-bluetooth'}
  | {kind: 'bluetooth-off'}
  | {kind: 'failed'};

/**
 * What the counter should say about being approached rather than scanned.
 *
 * Bluetooth is the only way a counter can be approached rather than scanned, so
 * a merchant who has not granted it is told so plainly. Saying nothing would
 * leave a counter showing a QR and no answer to whether anyone can be served
 * without pointing a camera at it.
 */
export function proximityOfferState(input: {
  proximity: {
    supported: boolean;
    canBroadcast: boolean;
    enabled: boolean;
    authorized: boolean;
    broadcasting: boolean;
    broadcastError?: string;
  };
}): ProximityOfferState {
  const {proximity} = input;
  const usable = proximity.canBroadcast && proximity.authorized && proximity.enabled;

  if (usable && proximity.broadcasting) return {kind: 'live'};
  // A merchant who has not granted Bluetooth is told so. Silence here is the
  // state hardest to act on: a counter showing a QR and saying nothing about
  // whether anyone can be served without pointing a camera at it.
  if (proximity.supported && !proximity.authorized) return {kind: 'needs-bluetooth'};
  if (proximity.supported && !proximity.enabled) return {kind: 'bluetooth-off'};
  if (proximity.broadcastError) return {kind: 'failed'};
  if (usable) return {kind: 'preparing'};
  return {kind: 'hidden'};
}

/**
 * One line for the radios, because to a merchant they are one fact: whether a
 * customer can be served without pointing a camera at the counter. Two rows
 * saying "let them tap" and "let them hold their phone here" described an
 * implementation split, not anything happening on the counter.
 */
function ProximityOffer({proximity}: {proximity: ReturnType<typeof useProximityBroadcast>}) {
  const t = useTranslate();
  const state = proximityOfferState({proximity});
  // What the radio last did, in its own words. "Hidden" meant a counter showing
  // a QR could say nothing at all about whether anyone could hold a phone to
  // it, which is the state hardest to act on and the one that looks exactly
  // like the feature not existing.
  const log = useProximityDiagnostics();
  const latest = log[0]?.message;
  /**
   * The merchant half has only ever shown the newest line, and the newest line
   * is a place the radio passes through: published, on the air, a customer
   * connected, frames sent. Reading a counter that is not being paid means
   * reading the steps it took to get there, and this is the one screen that
   * has to be open for any of them to happen — the timestamped log in
   * developer settings cannot be open at the same time. Folded away, because
   * the counter is also what a customer is standing in front of.
   */
  const [showLog, setShowLog] = useState(false);
  if (state.kind === 'hidden' && !latest) return null;

  return (
    <>
    <Pressable
      accessibilityRole="button"
      onPress={() => setShowLog(open => !open)}
      style={styles.radioRow}
      testID={`proximity-${state.kind}`}>
      <Bluetooth color={colors.amber} size={18} />
      <Text numberOfLines={2} style={styles.radioText}>
        {latest ?? (state.kind === 'live'
          ? t('Or let the customer hold their phone against this one')
          : state.kind === 'needs-bluetooth'
            ? t('Allow Bluetooth so an iPhone customer can pay by holding their phone here')
            : state.kind === 'bluetooth-off'
              ? t('Turn on Bluetooth so an iPhone customer can pay by holding their phone here')
              : state.kind === 'failed'
                ? t('Holding phones together is unavailable right now; use the QR code')
                : t('Preparing to be held against'))}
      </Text>
      {state.kind === 'needs-bluetooth' ? (
        <Button onPress={proximity.request} testID="allow-proximity-broadcast" tone="ghost">
          {t('Allow Bluetooth')}
        </Button>
      ) : state.kind === 'failed' ? (
        <Button
          icon={<RefreshCw color={colors.black} size={16} />}
          onPress={() => proximity.retry()}
          testID="retry-proximity-broadcast"
          tone="ghost">
          {t('Retry')}
        </Button>
      ) : null}
    </Pressable>
    {showLog && log.length > 0 ? (
      <View style={styles.radioLog} testID="proximity-log">
        {log.map((entry, index) => (
          <Text key={`${entry.at}-${index}`} selectable style={styles.radioLogLine}>
            {entry.at}  {entry.message}
          </Text>
        ))}
      </View>
    ) : null}
    </>
  );
}

/**
 * Whether this request's QR and radio should be on, right now.
 *
 * Two rules, and the second is the one that was wrong. A request must have a
 * fresh ledger observation behind it: losing Testnet while a code is on the
 * counter would invite a customer to pay a request whose five-minute window
 * this phone can no longer check. And it must not have been claimed — a
 * request leaves `awaiting_approval` the moment a customer takes it, and
 * handing it to a second one is worth preventing.
 *
 * But an *unknown* status is not a claimed one. This used to demand
 * `awaiting_approval` outright, and that status only arrives on the next poll
 * — a whole round trip after publishing, and on a host that sleeps between
 * demos a long one, with a failed poll pushing it to the one after that. The
 * merchant had a request card with no code on it and no way to be paid.
 * Publishing is what makes a request payable, and the API writes
 * `awaiting_approval` in the same transaction that stores the intent, so
 * nothing is being assumed here that has not already happened.
 */
export function shouldShowRequest(input: {
  published: boolean;
  /** `undefined` means the poll has not answered yet, not that it is closed. */
  settlementStatus: string | undefined;
  ledgerUnavailable: boolean;
  latestLedger: number | undefined;
  expiresAtLedger: number;
}): boolean {
  const {published, settlementStatus, ledgerUnavailable, latestLedger, expiresAtLedger} = input;
  if (!published || ledgerUnavailable || latestLedger === undefined) return false;
  if (expiresAtLedger - latestLedger <= 0) return false;
  return settlementStatus === undefined || isOfferable(settlementStatus);
}

/** The white margin a scanner needs around a code to read it reliably. */
const QR_PLATE_PADDING = spacing.lg;

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
  pill: {alignItems: 'center', borderColor: colors.line, borderRadius: radius.round, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs},
  pillSelected: {backgroundColor: colors.gold, borderColor: colors.gold},
  pillText: {color: colors.inkMuted, fontSize: 13, fontWeight: '600'},
  pillTextSelected: {color: colors.ink},
  conversion: {color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs},
  asset: {color: colors.goldBright, fontSize: 15},
  reference: {color: colors.inkMuted, fontSize: 12, marginTop: spacing.xs},
  radioRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center'},
  radioText: {color: colors.inkMuted, flexShrink: 1, fontSize: 13},
  countdown: {alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: spacing.xs, justifyContent: 'center'},
  countdownText: {...typography.label, color: colors.amber, fontSize: 13, letterSpacing: 0.6},
  countdownUrgent: {color: colors.danger},
  radioLog: {backgroundColor: colors.black, borderRadius: radius.sm, gap: 2, padding: spacing.sm},
  radioLogLine: {color: colors.inkMuted, fontSize: 11, lineHeight: 15},
  qrArea: {gap: spacing.lg, width: '100%'},
  qr: {alignItems: 'center', alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: radius.sm, justifyContent: 'center'},
  qrPlaceholder: {alignItems: 'center', alignSelf: 'center', gap: spacing.sm, justifyContent: 'center', padding: spacing.lg, width: '100%'},
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
