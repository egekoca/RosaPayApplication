import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Bluetooth, ChevronRight, Nfc, Plus, ReceiptText, RefreshCw, ScanLine, ShieldCheck, Store} from 'lucide-react-native';
import {useMemo, useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, PressScale, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {businessEmailSchema} from '../merchant/merchantProfile';
import {ModeSwitcher} from '../../shared/ModeSwitcher';
import {RosaMark} from '../../shared/RosaMark';
import {useMerchantPayments} from '../merchant/merchantRequestStatus';
import {MERCHANT_PAGE_SIZE, orderMerchantPayments} from '../merchant/paymentOrder';
import {
  outcomeLabel,
  PaymentDetailSheet,
  type MerchantPaymentDetail,
} from '../merchant/PaymentDetailSheet';
import {paymentOutcome} from '../merchant/paymentOutcome';
import {Screen} from '../../shared/Screen';
import {useWalletBalance} from '../../shared/useWalletBalance';
import {displayAmount, exactAmount} from '../../shared/displayAmount';
import {useBalanceValue} from '../../shared/useBalanceValue';
import {shareValue} from '../../shared/shareAddress';
import {useAppStore} from '../../state/appStore';
import {useCurrentAccount} from '../wallet/currentAccount';
import {useTranslate} from '../../shared/i18n';
import {generateRecoveryPhrase} from '../wallet/stellarKey';
import {CurrencyPicker} from './CurrencyPicker';
import {greetingFor} from './greeting';
import {PaymentCard} from './PaymentCard';
import {AssetMark} from './AssetMark';
import {payableAssetByCode} from '../payments/assets';
import {useNfcTapControl} from '../payments/nfcTapControl';
import {useProximityStatus} from '../payments/useProximity';
import {currencySymbol} from '../../shared/priceSource';

type Props = NativeStackScreenProps<RootStackParams, 'Main'>;

export function HomeScreen({navigation}: Props) {
  const {mode, merchantProfile, account} = useAppStore();
  const t = useTranslate();
  const merchantEnabled = Boolean(merchantProfile && businessEmailSchema.safeParse(merchantProfile.email).success);
  const greeting = greetingFor(account?.name);
  const [greetingPart, ...greetingName] = greeting.split(', ');
  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.identity}>
          <RosaMark motion="float" size={38} />
          <View><Text style={styles.eyebrow}>{t('ROSA PAY')}</Text><Text style={styles.greeting} numberOfLines={1}>{`${t(greetingPart!)}${greetingName.length ? `, ${greetingName.join(', ')}` : ''}`}</Text></View>
        </View>

      </View>
      <WalletOverview />
      {merchantEnabled ? <ModeSwitcher /> : null}
      <AnimatedContent key={mode} delay={60} distance={14} scaleFrom={0.99} style={styles.modeStage}>
        {mode === 'customer' || !merchantEnabled ? (
          <CustomerHome navigation={navigation} merchantEnabled={merchantEnabled} />
        ) : (
          <MerchantHome navigation={navigation} />
        )}
      </AnimatedContent>
    </Screen>
  );
}

/** Stays mounted in the same position while the task below it changes. */
function WalletOverview() {
  const account = useCurrentAccount();
  const displayCurrency = useAppStore(state => state.displayCurrency);
  const setDisplayCurrency = useAppStore(state => state.setDisplayCurrency);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const balance = useWalletBalance();
  const value = useBalanceValue(balance.data);
  const address = account?.address;
  return (
    <>
      <AnimatedContent>
        <PaymentCard
          holdings={balance.data ?? []}
          currency={displayCurrency}
          onChangeCurrency={() => setPickingCurrency(true)}
          {...(value.data ? {value: value.data} : {})}
          {...(address === undefined ? {} : {address})}
          state={
            !account ? 'no-wallet' : balance.isPending ? 'loading' : balance.isError ? 'error' : 'ready'
          }
          onCopy={() => address && void shareValue('My Rosa Pay wallet', address)}
        />
      </AnimatedContent>
      <CurrencyPicker
        onClose={() => setPickingCurrency(false)}
        onSelect={setDisplayCurrency}
        selected={displayCurrency}
        visible={pickingCurrency}
      />
    </>
  );
}

function CustomerHome({navigation, merchantEnabled}: {navigation: Props['navigation']; merchantEnabled: boolean}) {
  const t = useTranslate();
  const account = useCurrentAccount();
  const identity = useAppStore(state => state.account);
  const receipts = useAppStore(state => state.receipts);
  // Set only where a reader has to be opened by hand, which today means iOS.
  const startTap = useNfcTapControl(state => state.startTap);
  const proximity = useProximityStatus();
  // Both platforms ask about Bluetooth exactly once. After a refusal the prompt
  // never comes back, so a second press has to lead somewhere that can still
  // change the answer rather than silently doing nothing.
  const [askedForBluetooth, setAskedForBluetooth] = useState(false);
  const refused = askedForBluetooth && !proximity.authorized;
  /*
    Granted but switched off is just as silent as never asked, and it is the
    one state no prompt can fix: Core Bluetooth has nothing to turn on, so the
    only honest thing to offer is Settings. Without this the row vanished the
    moment permission was granted and a phone with the radio off went back to
    doing nothing for no stated reason.
  */
  const switchedOff = proximity.authorized && !proximity.enabled;
  const proximityBlocked = proximity.supported && (!proximity.authorized || switchedOff);
  const enableProximity = () => {
    if (refused || switchedOff) {
      void Linking.openSettings();
      return;
    }
    setAskedForBluetooth(true);
    proximity.request();
  };
  const balance = useWalletBalance();
  const value = useBalanceValue(balance.data);
  const finishWalletSetup = () => {
    navigation.replace('RecoveryPhrase', {
      phrase: generateRecoveryPhrase(),
      name: identity?.name ?? 'You',
      ...(identity?.email ? {email: identity.email} : {}),
    });
  };

  return (
    <>

      {/*
        Only a phone that chose device custody can finish setup this way; a
        recovery-phrase account is already an account, and offering to deploy a
        smart wallet over it would make a second wallet nobody asked for.
      */}
      {!account ? (
        <AnimatedContent delay={70}>
          <View accessibilityRole="alert" style={styles.walletSetup}>
            <View style={styles.walletSetupCopy}>
              <Text style={styles.walletSetupTitle}>{t('Finish wallet setup')}</Text>
              <Text style={styles.walletSetupHint}>
                {t('This account has no wallet yet. Twelve words will make one, and they are what lets you add money in lira.')}
              </Text>
            </View>
            <Button
              icon={<RefreshCw color={colors.black} size={18} />}
              onPress={finishWalletSetup}
              testID="finish-wallet-setup">
              {t('Create the wallet')}
            </Button>
          </View>
        </AnimatedContent>
      ) : null}

      {/*
        Bluetooth is what makes "walk up and pay" true between two iPhones, and
        it needs one grant before it can ever be silent. Ask here, once, where
        someone is already looking for how to pay — not at launch, where a
        permission sheet on a wallet asking about Bluetooth explains nothing.
        The row is gone for good once granted.
      */}
      {proximityBlocked ? (
        <AnimatedContent delay={80}>
          <PressScale>
            <Pressable
              accessibilityRole="button"
              onPress={enableProximity}
              style={styles.tapAction}
              testID="home-allow-proximity">
              <View style={styles.tapIcon}>
                <Bluetooth color={colors.black} size={24} />
              </View>
              <View style={styles.scanCopy}>
                <Text style={styles.scanTitle}>
                  {switchedOff
                    ? t('Switch Bluetooth on to pay by holding phones together')
                    : refused
                      ? t('Allow Bluetooth in Settings')
                      : t('Turn on paying by holding phones together')}
                </Text>
                <Text style={styles.scanHint}>{t('Rosa Pay finds the merchant you are standing at, and nothing else.')}</Text>
              </View>
              <ChevronRight color={colors.inkMuted} size={19} />
            </Pressable>
          </PressScale>
        </AnimatedContent>
      ) : null}

      {/*
        The two ways to pay, side by side and the same size, because they are
        the same decision: a customer who has walked up to a counter picks the
        one the merchant's phone is offering. Stacked full-width rows made the
        second look like a lesser version of the first.

        On iOS a Core NFC reader cannot sit armed, so tapping needs a press to
        open it; on Android the phone is already listening and no opener
        exists, which leaves scanning alone and full width.
      */}
      <AnimatedContent delay={90}>
        <View style={[styles.actionRow, proximityBlocked || startTap ? styles.actionRowUnderTap : null]}>
          <View style={styles.actionHalf}>
            <PressScale>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('Scan')}
                style={styles.actionTile}
                testID="scan-to-pay">
                <View style={styles.scanIcon}>
                  <ScanLine color={colors.black} size={24} />
                </View>
                <Text style={styles.tileTitle}>{t('Scan to pay')}</Text>
                <Text style={styles.tileHint}>{t('Scan a code or hold phones together')}</Text>
              </Pressable>
            </PressScale>
          </View>
          {startTap ? (
            <View style={styles.actionHalf}>
              <PressScale>
                <Pressable
                  accessibilityRole="button"
                  onPress={startTap}
                  style={styles.actionTile}
                  testID="home-tap-to-pay">
                  <View style={styles.tapIcon}>
                    <Nfc color={colors.black} size={24} />
                  </View>
                  <Text style={styles.tileTitle}>{t('Tap to pay')}</Text>
                  <Text style={styles.tileHint}>{t("Hold this phone against the merchant's")}</Text>
                </Pressable>
              </PressScale>
            </View>
          ) : null}
        </View>
      </AnimatedContent>

      {/*
        Only until there is a counter to open.
        
        Being paid is one of the two things this app is for, and for an account
        that had never sold anything it was a line of small print with no
        visible way to start — so it reads like the way to pay, because it is
        the same size decision. Once a profile exists the switcher at the top
        of the screen is already the way across, and this said the same thing a
        second time, further down and less well.
      */}
      {merchantEnabled ? null : (
      <AnimatedContent delay={110}>
        <PressScale>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('MerchantOnboarding')}
            style={styles.merchantAction}
            testID="activate-merchant">
            <View style={styles.merchantIcon}>
              <Store color={colors.black} size={24} />
            </View>
            <View style={styles.scanCopy}>
              <Text style={styles.scanTitle}>{t('Get paid with this account')}</Text>
              <Text style={styles.scanHint}>{t('Set up your counter and take your first payment')}</Text>
            </View>
            <ChevronRight color={colors.inkMuted} size={19} />
          </Pressable>
        </PressScale>
      </AnimatedContent>
      )}

      {/*
        A recovery-phrase account can use the lira rail. Keep that funding
        action below the two core Pay/Get paid choices; a smart-wallet phone is
        not shown a door that closes.
      */}
      {account?.kind === 'classic' ? (
        <AnimatedContent delay={120}>
          <PressScale>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('LiraDeposit')}
              style={styles.liraAction}
              testID="add-lira">
              {/*
                The lira mark and the flag rather than a generic banknote. This
                row is the one place in the app where a Turkish customer is
                being offered their own money, and a wallet icon said "money"
                where it could have said "yours".
              */}
              <View style={styles.liraIcon}>
                <Text style={styles.liraSymbol}>₺</Text>
                <Text style={styles.liraFlag}>🇹🇷</Text>
              </View>
              <View style={styles.scanCopy}>
                <Text style={styles.liraTitle}>{t('Add money with Turkish lira')}</Text>
                <Text style={styles.scanHint}>{t('Bank transfer · receive USDC in your wallet')}</Text>
              </View>
              <ChevronRight color={colors.inkMuted} size={19} />
            </Pressable>
          </PressScale>
        </AnimatedContent>
      ) : null}

      {/*
        What the total is made of. The card answers "what is this worth"; two
        assets in a wallet raise "worth of what", and doing that arithmetic in
        your head against a single converted number is not a thing to ask.
      */}
      {(balance.data ?? []).length > 0 ? (
        <AnimatedContent delay={140}>
          <Text style={styles.listTitle}>{t('Assets')}</Text>
          <View style={styles.assetList}>
            {(balance.data ?? []).map(holding => {
              const valued = value.data?.holdings.find(entry => entry.code === holding.code);
              return (
                <View key={holding.code} style={styles.assetRow}>
                  <AssetMark code={holding.code} size={34} />
                  <View style={styles.assetCopy}>
                    <Text style={styles.assetName}>{payableAssetByCode(holding.code)?.name ?? holding.code}</Text>
                    {/*
                      The payload's own digits with the trailing zeros dropped.
                      Rounding here would hide dust someone is holding, and
                      "10,000.0000000" is seven zeros nobody asked to read.
                    */}
                    <Text style={styles.assetAmount}>
                      {exactAmount(holding.amount)} {holding.code}
                    </Text>
                  </View>
                  {valued ? <Text style={styles.assetValue}>{currencySymbol(value.data!.currency)}{valued.value}</Text> : null}
                </View>
              );
            })}
          </View>
        </AnimatedContent>
      ) : null}

      <AnimatedContent delay={160}>
        <Text style={styles.listTitle}>{t('Payments')}</Text>
        {receipts.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyTitle}>{t('No payments yet')}</Text>
            <Text style={styles.emptyHint}>{t('Your payment history will appear here.')}</Text>
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
                <Text numberOfLines={1} style={styles.listAmount}>−{displayAmount(receipt.amount)} {receipt.assetCode}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </AnimatedContent>

    </>
  );
}

function MerchantHome({navigation}: {navigation: Props['navigation']}) {
  const t = useTranslate();
  const receipts = useAppStore(state => state.receipts);
  const merchantProfile = useAppStore(state => state.merchantProfile);
  const merchantRegisteredOnChain = useAppStore(state => state.merchantRegisteredOnChain);
  const pendingRequest = useAppStore(state => state.pendingRequest);
  const setPendingRequest = useAppStore(state => state.setPendingRequest);
  const payments = useMerchantPayments(merchantProfile?.merchantProfileId);

  // On Testnet the API knows every request this merchant made, from any device;
  // a device on its own only has what it recorded itself.
  // A fresh `[]` on every render would defeat the memo below, which is the one
  // place the list is actually sorted.
  const apiPayments = useMemo(() => payments.data?.payments ?? [], [payments.data]);
  const useApi = payments.isSuccess;
  const localReceipts = useMemo(
    () => receipts.filter(receipt => receipt.recipient === merchantProfile?.recipient),
    [merchantProfile?.recipient, receipts],
  );
  const received = useApi ? apiPayments : localReceipts;
  const settled = received.filter(payment => payment.status === 'confirmed');
  const statusTone = payments.isError ? 'neutral' : payments.isPending ? 'pending' : 'success';
  const [detail, setDetail] = useState<MerchantPaymentDetail | null>(null);
  // Live requests first, then the rest a page at a time. A counter reads the
  // top of this list while a customer waits; the history below it is for
  // afterwards.
  // Sorted inside each branch rather than over the union: the API's shape and
  // the device's differ, and collapsing them here would lose the difference the
  // rows below still read.
  const ordered = useMemo(
    () => (useApi ? orderMerchantPayments(apiPayments) : orderMerchantPayments(localReceipts)),
    [apiPayments, localReceipts, useApi],
  );
  const [shown, setShown] = useState(MERCHANT_PAGE_SIZE);
  const visible = ordered.slice(0, shown);
  return (
    <>
      <AnimatedContent>
        <View style={styles.modeIntro}>
          <View style={styles.modeIntroRow}>
            <View style={styles.modeIntroCopy}>
              <Text numberOfLines={1} style={styles.modeTitle}>
                {merchantProfile?.displayName ?? t('Get paid')}
              </Text>
            </View>
            <StatusPill tone={statusTone}>{payments.isError ? t('LOCAL') : payments.isPending ? t('SYNCING') : t('LIVE')}</StatusPill>
          </View>
        </View>
      </AnimatedContent>

      {/*
        One button, and it always does the one thing this screen is for.
        
        It used to become "Open active request" once a request existed, so the
        merchant's next customer had to go through the last one. Pairing it with
        a second button for the live request only moved the clutter: every
        request, live or finished, is already a row in the list below, and
        tapping a row is already how a merchant opens one. The live one offers
        its code from there.
      */}
      <AnimatedContent delay={140}>
        <Button
          icon={<Plus color={colors.black} size={20} />}
          onPress={() => {
            // Cleared so the screen opens on the form rather than on the card
            // for the last one. Its history lives on the API and in the list.
            setPendingRequest(null);
            navigation.navigate('MerchantRequest');
          }}
          testID="create-new-payment">
          {t('New payment')}
        </Button>
      </AnimatedContent>

      <AnimatedContent delay={190}>
        <View style={styles.merchantMeta}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaValue}>{settled.length}</Text>
            <Text style={styles.metaLabel}>{t('SETTLED')}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaBlock}>
            <Text style={styles.metaValue}>{received.length - settled.length}</Text>
            <Text style={styles.metaLabel}>{t('OPEN')}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaBlock}>
            <Text style={styles.metaValue}>{pendingRequest ? '1' : '0'}</Text>
            <Text style={styles.metaLabel}>{t('ACTIVE QR')}</Text>
          </View>
        </View>
      </AnimatedContent>

      <AnimatedContent delay={230}>
        <>
          <SectionTitle title={t('Business status')} />
          <SurfaceCard padded={false} style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={styles.capabilityIcon}>
                <ShieldCheck color={merchantRegisteredOnChain ? colors.success : colors.goldBright} size={19} />
              </View>
              <View style={styles.activityCopy}>
                <Text style={styles.activityTitle}>
                  {merchantRegisteredOnChain ? t('Receiving address verified') : t('Verification in progress')}
                </Text>
                <Text style={styles.address}>
                  {merchantProfile?.recipient
                    ? `${merchantProfile.recipient.slice(0, 8)}...${merchantProfile.recipient.slice(-6)}`
                    : t('No address on file')}
                </Text>
              </View>
              <StatusPill tone={merchantRegisteredOnChain ? 'success' : 'pending'}>
                {merchantRegisteredOnChain ? t('READY') : t('ACTION')}
              </StatusPill>
            </View>
          </SurfaceCard>
        </>
      </AnimatedContent>

      <AnimatedContent delay={280}>
        <>
          <SectionTitle title={t('Recent payments')} />
          {received.length === 0 ? (
            <View style={styles.merchantEmptyRow}>
              <View style={styles.emptyIcon}>
                <ReceiptText color={colors.goldBright} size={18} />
              </View>
              <View style={styles.emptyCopy}>
                <Text style={styles.emptyTitle}>{t('No payments yet')}</Text>
                <Text style={styles.emptyHint}>{t('Create a request and keep this screen open at the counter.')}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.list}>
              {visible.map(payment => {
                const outcome = paymentOutcome(payment.status);
                // A request that is over is still worth listing and still worth
                // opening, but it should not read as money on the counter. The
                // plus sign and the green receipt used to be on every row,
                // including ones nobody ever paid.
                const closed = outcome === 'closed';
                return (
                  <PressScale key={payment.intentId}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        setDetail({
                          intentId: payment.intentId,
                          ...('reference' in payment ? {reference: payment.reference} : {}),
                          amount: payment.amount,
                          assetCode: payment.assetCode,
                          createdAt: payment.createdAt,
                          status: payment.status,
                          ...(payment.transactionHash ? {transactionHash: payment.transactionHash} : {}),
                          ...(payment.ledger === undefined ? {} : {ledger: payment.ledger}),
                          ...(payment.confirmedAt ? {confirmedAt: payment.confirmedAt} : {}),
                        })
                      }
                      style={[styles.listRow, closed && styles.listRowClosed]}
                      testID={`merchant-payment-${payment.intentId}`}>
                      <View style={styles.listIcon}>
                        <ReceiptText
                          color={outcome === 'paid' ? colors.success : closed ? colors.inkFaint : colors.goldBright}
                          size={17}
                        />
                      </View>
                      <View style={styles.listCopy}>
                        <Text numberOfLines={1} style={[styles.listName, closed && styles.listMuted]}>
                          {'reference' in payment ? payment.reference : t('Payment received')}
                        </Text>
                        <Text style={styles.listWhen}>
                          {`${new Date(payment.createdAt).toLocaleDateString()} · ${t(outcomeLabel(payment.status))}`}
                        </Text>
                      </View>
                      <View style={styles.listAmountBlock}>
                        <Text numberOfLines={1} style={[styles.listAmount, closed && styles.listMuted]}>
                          {outcome === 'paid' ? '+' : ''}{displayAmount(payment.amount)}
                        </Text>
                        <Text style={[styles.listAsset, closed && styles.listMuted]}>{payment.assetCode}</Text>
                      </View>
                    </Pressable>
                  </PressScale>
                );
              })}
              {ordered.length > visible.length ? (
                <PressScale>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setShown(count => count + MERCHANT_PAGE_SIZE)}
                    style={styles.showMore}
                    testID="show-more-payments">
                    <Text style={styles.showMoreText}>
                      {`${t('Show more')} (${ordered.length - visible.length})`}
                    </Text>
                  </Pressable>
                </PressScale>
              ) : null}
            </View>
          )}
        </>
      </AnimatedContent>

      <PaymentDetailSheet
        onClose={() => setDetail(null)}
        {...(detail && pendingRequest && detail.intentId === pendingRequest.intent.intentId
          ? {
              onShowCode: () => {
                setDetail(null);
                navigation.navigate('MerchantRequest');
              },
            }
          : {})}
        payment={detail}
      />
    </>
  );
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
  modeStage: {gap: spacing.lg},
  header: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  identity: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.line,
    borderRadius: radius.round,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  eyebrow: {...typography.overline, color: colors.goldBright, fontSize: 9, letterSpacing: 1.5},
  greeting: {...typography.title, color: colors.ink, fontSize: 20},

  liraAction: {alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.goldDeep, borderRadius: 22, borderWidth: 1, flexDirection: 'row', gap: 14, padding: 16},
  liraIcon: {alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.goldDeep, borderRadius: 999, borderWidth: 1, height: 48, justifyContent: 'center', width: 48},
  liraSymbol: {color: colors.goldBright, fontSize: 23, fontWeight: '700', lineHeight: 27},
  liraFlag: {bottom: -3, fontSize: 15, position: 'absolute', right: -4},
  liraTitle: {...typography.body, color: colors.ink, fontSize: 17, fontWeight: '600'},
  scanIcon: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  tapAction: {
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
  tapIcon: {
    alignItems: 'center',
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  /* The two ways to pay share a row and split it evenly. */
  actionRow: {flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl},
  // The Bluetooth row already carries the gap above it.
  actionRowUnderTap: {marginTop: spacing.md},
  actionHalf: {flex: 1},
  actionTile: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    // A tile is as tall as the taller of the two, so the pair reads as a pair
    // however long either hint runs.
    minHeight: 150,
    padding: spacing.lg,
  },
  tileTitle: {...typography.title, color: colors.ink, fontSize: 17},
  tileHint: {color: colors.inkMuted, fontSize: 12, lineHeight: 16},
  merchantAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  merchantIcon: {
    alignItems: 'center',
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  scanCopy: {flex: 1, gap: 3},
  scanTitle: {...typography.title, color: colors.ink, fontSize: 18},
  scanHint: {color: colors.inkMuted, fontSize: 13, lineHeight: 18},

  listTitle: {...typography.overline, color: colors.inkFaint, marginBottom: spacing.md, marginTop: spacing.xxl},
  assetList: {gap: spacing.xs},
  assetRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 58},
  assetCopy: {flex: 1, gap: 2},
  assetName: {...typography.body, color: colors.ink, fontSize: 16, fontWeight: '600'},
  assetAmount: {...typography.mono, color: colors.inkFaint, fontSize: 12},
  assetValue: {...typography.body, color: colors.ink, fontSize: 16, fontWeight: '600'},
  showMore: {alignItems: 'center', borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, justifyContent: 'center', minHeight: 46},
  showMoreText: {...typography.label, color: colors.inkMuted, fontSize: 12},
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
  listRowClosed: {opacity: 0.55},
  listMuted: {color: colors.inkMuted},
  listAmount: {...typography.label, color: colors.ink, fontSize: 14},

  emptyRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.xs,
    padding: spacing.xl,
  },
  merchantEmptyRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldDeep,
    borderRadius: radius.round,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  emptyCopy: {flex: 1, gap: spacing.xs},
  emptyTitle: {...typography.label, color: colors.ink, fontSize: 15},
  emptyHint: {color: colors.inkMuted, fontSize: 13, lineHeight: 19},


  walletSetup: {
    borderBottomColor: colors.lineSoft,
    borderBottomWidth: 1,
    borderTopColor: colors.lineSoft,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  walletSetupCopy: {gap: spacing.xs},
  walletSetupTitle: {...typography.label, color: colors.ink, fontSize: 15},
  walletSetupHint: {color: colors.inkMuted, fontSize: 13, lineHeight: 19},
  walletSetupError: {...typography.label, color: colors.danger, fontSize: 12, lineHeight: 17},

  modeIntro: {},
  modeIntroRow: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  modeIntroCopy: {flex: 1, gap: 2},
  modeTitle: {...typography.title, color: colors.ink, fontSize: 26},
  merchantMeta: {
    alignItems: 'center',
    borderBottomColor: colors.lineSoft,
    borderBottomWidth: 1,
    borderTopColor: colors.lineSoft,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
  },
  metaBlock: {alignItems: 'center', flex: 1, gap: 2},
  metaValue: {...typography.title, color: colors.ink, fontSize: 18},
  metaLabel: {...typography.overline, color: colors.inkFaint, fontSize: 8, letterSpacing: 1},
  metaDivider: {backgroundColor: colors.line, height: 28, width: 1},
  sectionTitle: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm},
  sectionLabel: {...typography.label, color: colors.ink, fontSize: 14},
  sectionAction: {...typography.label, color: colors.goldBright, fontSize: 12},
  activityCopy: {flex: 1, gap: 2},
  activityTitle: {...typography.label, color: colors.ink, fontSize: 13},
  capabilityIcon: {alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.goldDeep, borderRadius: radius.round, borderWidth: 1, height: 36, justifyContent: 'center', width: 36},
  address: {...typography.mono, color: colors.inkMuted, fontSize: 11},
  statusCard: {overflow: 'hidden'},
  statusRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.lg},
  listAmountBlock: {alignItems: 'flex-end', gap: 2},
  listAsset: {...typography.mono, color: colors.goldBright, fontSize: 10, letterSpacing: 0.8},
});
