import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Bluetooth, ChevronRight, Nfc, QrCode, ReceiptText, RefreshCw, ScanLine, ShieldCheck, Store} from 'lucide-react-native';
import {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AnimatedContent, Button, colors, PressScale, radius, spacing, StatusPill, SurfaceCard, typography} from '@rosapay/ui';
import type {RootStackParams} from '../../app/navigation';
import {businessEmailSchema} from '../merchant/merchantProfile';
import {ModeSwitcher} from '../../shared/ModeSwitcher';
import {RosaMark} from '../../shared/RosaMark';
import {useMerchantPayments} from '../merchant/merchantRequestStatus';
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
  const setMode = useAppStore(state => state.setMode);
  // Set only where a reader has to be opened by hand, which today means iOS.
  const startTap = useNfcTapControl(state => state.startTap);
  const proximity = useProximityStatus();
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
      {proximity.supported && !proximity.authorized ? (
        <AnimatedContent delay={80}>
          <PressScale>
            <Pressable
              accessibilityRole="button"
              onPress={proximity.request}
              style={styles.tapAction}
              testID="home-allow-proximity">
              <View style={styles.tapIcon}>
                <Bluetooth color={colors.black} size={24} />
              </View>
              <View style={styles.scanCopy}>
                <Text style={styles.scanTitle}>{t('Turn on paying by holding phones together')}</Text>
                <Text style={styles.scanHint}>{t('Rosa Pay finds the merchant you are standing at, and nothing else.')}</Text>
              </View>
              <ChevronRight color={colors.inkMuted} size={19} />
            </Pressable>
          </PressScale>
        </AnimatedContent>
      ) : null}

      {/*
        On iOS a Core NFC reader cannot sit armed, so the customer has to open
        it. That opener used to live behind the camera screen, which made
        tapping feel like a fallback inside scanning rather than its own way to
        pay. It stays available for an Android merchant publishing over NFC;
        Bluetooth covers the rest without a press. On Android this is never
        rendered, because the phone is already listening.
      */}
      {startTap ? (
        <AnimatedContent delay={85}>
          <PressScale>
            <Pressable
              accessibilityRole="button"
              onPress={startTap}
              style={styles.tapAction}
              testID="home-tap-to-pay">
              <View style={styles.tapIcon}>
                <Nfc color={colors.black} size={24} />
              </View>
              <View style={styles.scanCopy}>
                <Text style={styles.scanTitle}>{t('Tap to pay')}</Text>
                <Text style={styles.scanHint}>{t("Hold this phone against the merchant's")}</Text>
              </View>
              <ChevronRight color={colors.inkMuted} size={19} />
            </Pressable>
          </PressScale>
        </AnimatedContent>
      ) : null}

      <AnimatedContent delay={90}>
        <PressScale>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Scan')}
            // The rows read as one group when a proximity action sits above.
            style={[styles.scanAction, startTap || (proximity.supported && !proximity.authorized) ? styles.scanActionUnderTap : null]}
            testID="scan-to-pay">
            <View style={styles.scanIcon}>
              <ScanLine color={colors.black} size={24} />
            </View>
            <View style={styles.scanCopy}>
              <Text style={styles.scanTitle}>{t('Scan to pay')}</Text>
              <Text style={styles.scanHint}>{t('Scan a code or hold phones together')}</Text>
            </View>
            <ChevronRight color={colors.inkMuted} size={19} />
          </Pressable>
        </PressScale>
      </AnimatedContent>

      <AnimatedContent delay={110}>
        <PressScale>
          <Pressable
            accessibilityRole="button"
            onPress={() => (merchantEnabled ? setMode('merchant') : navigation.navigate('MerchantOnboarding'))}
            style={styles.merchantRow}
            testID="activate-merchant">
            <Store color={colors.amber} size={18} />
            <Text style={styles.merchantText}>{t('Get paid with this account')}</Text>
            <ChevronRight color={colors.inkMuted} size={17} />
          </Pressable>
        </PressScale>
      </AnimatedContent>

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
  const payments = useMerchantPayments(merchantProfile?.merchantProfileId);

  // On Testnet the API knows every request this merchant made, from any device;
  // a device on its own only has what it recorded itself.
  const apiPayments = payments.data?.payments ?? [];
  const useApi = payments.isSuccess;
  const localReceipts = receipts.filter(receipt => receipt.recipient === merchantProfile?.recipient);
  const received = useApi ? apiPayments : localReceipts;
  const settled = received.filter(payment => payment.status === 'confirmed');
  const statusTone = payments.isError ? 'neutral' : payments.isPending ? 'pending' : 'success';
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

      <AnimatedContent delay={140}>
        <Button icon={<QrCode color={colors.black} size={20} />} onPress={() => navigation.navigate('MerchantRequest')}>
          {pendingRequest ? t('Open active request') : t('Create payment request')}
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
              {received.slice(0, 4).map(payment => (
                <View key={payment.intentId} style={styles.listRow}>
                  <View style={styles.listIcon}>
                    <ReceiptText color={colors.success} size={17} />
                  </View>
                  <View style={styles.listCopy}>
                    <Text numberOfLines={1} style={styles.listName}>
                      {'reference' in payment ? payment.reference : t('Payment received')}
                    </Text>
                    <Text style={styles.listWhen}>{new Date(payment.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.listAmountBlock}>
                    <Text numberOfLines={1} style={styles.listAmount}>+{displayAmount(payment.amount)}</Text>
                    <Text style={styles.listAsset}>{payment.assetCode}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      </AnimatedContent>
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
  scanAction: {
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
  scanActionUnderTap: {marginTop: spacing.md},
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

  merchantRow: {
    alignItems: 'center',
    borderTopColor: colors.lineSoft,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xxl,
    paddingTop: spacing.xl,
  },
  merchantText: {...typography.label, color: colors.ink, flex: 1, fontSize: 14},

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
