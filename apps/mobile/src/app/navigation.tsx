import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useNavigation, type NavigationContainerRef, type NavigationProp} from '@react-navigation/native';
import {BarChart3, UserRound, WalletCards} from 'lucide-react-native';
import {colors} from '@rosapay/ui';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';

import {HomeScreen} from '../features/home/HomeScreen';
import {AnchorTransferScreen} from '../features/wallet/AnchorTransferScreen';
import {LiraDepositScreen} from '../features/wallet/LiraDepositScreen';
import {WelcomeScreen} from '../features/onboarding/WelcomeScreen';
import {CreateAccountScreen} from '../features/onboarding/CreateAccountScreen';
import {RecoveryPhraseScreen} from '../features/onboarding/RecoveryPhraseScreen';
import {ImportWalletScreen} from '../features/onboarding/ImportWalletScreen';
import {RecoverWalletScreen} from '../features/onboarding/RecoverWalletScreen';
import {ScanScreen} from '../features/payments/ScanScreen';
import {PaymentConfirmationScreen} from '../features/payments/PaymentConfirmationScreen';
import {ReceiptScreen} from '../features/payments/ReceiptScreen';
import {DeveloperSettingsScreen} from '../features/settings/DeveloperSettingsScreen';
import {ProfileScreen} from '../features/profile/ProfileScreen';
import {useTranslate} from '../shared/i18n';
import {MerchantOnboardingScreen} from '../features/merchant/MerchantOnboardingScreen';
import {MerchantRequestScreen} from '../features/merchant/MerchantRequestScreen';
import {hasRestorableSession, useAppStore, type LocalReceipt} from '../state/appStore';
import type {PaymentTransport} from '../state/appStore';
import {DashboardScreen} from '../features/dashboard/DashboardScreen';
import {ForegroundPaymentListener} from '../features/payments/ForegroundPaymentListener';
import {useStellarHealth} from '../shared/useStellarHealth';

export type RootStackParams = {
  Welcome: undefined;
  /** `import` skips the custody choice and goes on to ask for a phrase. */
  CreateAccount: {intent: 'create' | 'import'} | undefined;
  /**
   * The words are passed, never stored: nothing writes them to disk. The name
   * travels with them because the account is only recorded once a wallet
   * actually exists — a failed setup must leave nothing behind.
   */
  RecoveryPhrase: {phrase: string; name: string; email?: string};
  ImportWallet: {name: string; email?: string};
  /** A phone that has never seen the wallet, holding only the synced passkey. */
  RecoverWallet: undefined;
  Main: undefined;
  /** Buying USDC with lira, through the anchor's SEP-6 door. */
  LiraDeposit: undefined;
  Scan: undefined;
  Confirm: {
    payload: SignedPaymentIntentV1;
    transport?: PaymentTransport;
    /**
     * Whether the way this request arrived already said what the customer
     * meant, so the device prompt may start without a button. A tap does; a
     * Bluetooth arrival does only when the phones were held together.
     */
    automatic?: boolean;
  };
  Receipt: {receipt: LocalReceipt};
  DeveloperSettings: undefined;
  MerchantOnboarding: undefined;
  /**
   * `registrationError` carries the reason on-chain registration failed during
   * onboarding. Without it the screen that follows can only say a merchant is
   * unregistered, not why — and the onboarding screen that knew is already gone.
   */
  MerchantRequest: {registrationError?: string} | undefined;
  AnchorTransfer: {kind: 'deposit' | 'withdraw'};
};


const Stack = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator();

/**
 * The two halves of the app: what your money is doing, and who you are.
 *
 * They were one scroll with a settings gear in a corner, which made the whole
 * of the second half reachable only through an icon nobody goes looking for.
 * A bar says both exist without anyone having to find out.
 */
/*
 * Inside a tab a screen is handed the tab's own navigation, which knows nothing
 * of Scan or Receipt. These reach past it to the stack the tabs sit in, so both
 * screens keep the one navigator that can actually go where they point.
 */
function WalletTab() {
  const navigation = useNavigation<NavigationProp<RootStackParams>>();
  return <HomeScreen navigation={navigation as never} route={{key: 'wallet', name: 'Main'} as never} />;
}

function ProfileTab() {
  const navigation = useNavigation<NavigationProp<RootStackParams>>();
  return <ProfileScreen navigation={navigation as never} />;
}

function DashboardTab() {
  return <DashboardScreen />;
}

// Hoisted so the tab bar is not handed a new component type on every render,
// which would tear down and rebuild the icon each time the language changes.
const walletIcon = ({color}: {color: string}) => <WalletCards color={color} size={22} />;
const profileIcon = ({color}: {color: string}) => <UserRound color={color} size={22} />;
const dashboardIcon = ({color}: {color: string}) => <BarChart3 color={color} size={22} />;

function MainTabs() {
  const t = useTranslate();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.goldBright,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.lineSoft,
          height: 88,
          paddingTop: 8,
        },
        tabBarLabelStyle: {fontSize: 11, fontWeight: '600'},
      }}>
      <Tabs.Screen
        name="WalletTab"
        component={WalletTab}
        options={{
          tabBarLabel: t('Wallet'),
          tabBarIcon: walletIcon,
        }}
      />
      <Tabs.Screen
        name="DashboardTab"
        component={DashboardTab}
        options={{
          tabBarLabel: t('Dashboard'),
          tabBarIcon: dashboardIcon,
        }}
      />
      <Tabs.Screen
        name="ProfileTab"
        component={ProfileTab}
        options={{
          tabBarLabel: t('Profile'),
          tabBarIcon: profileIcon,
        }}
      />
    </Tabs.Navigator>
  );
}

/**
 * Keeps the customer side ready for a merchant while the app is in a normal
 * foreground screen. Scan owns its reader session, and MerchantRequest owns
 * the outgoing radios, so neither route is armed here or a phone would be
 * talking to itself over two transports at once.
 */
// `getCurrentRoute()` returns the focused child of the tab navigator, not only
// the stack's `Main` route. Include all three tab leaves so a tap works while
// the app is open on Wallet, Dashboard or Profile.
const foregroundNfcRoutes = new Set<string>([
  'Main',
  'WalletTab',
  'DashboardTab',
  'ProfileTab',
  'LiraDeposit',
  'DeveloperSettings',
  'AnchorTransfer',
  'Receipt',
]);

export function shouldListenInForeground(routeName: string | undefined, locked: boolean): boolean {
  return !locked && routeName !== undefined && foregroundNfcRoutes.has(routeName);
}

/**
 * A failed React Query refetch may retain its previous `data` value. That value
 * is useful for ordinary rendering, but it is not a live ledger observation
 * for an NFC expiry decision. Treat any refetch error or malformed response as
 * unavailable so the receiver fails closed.
 */
export function freshLedgerFromRefetch(result: {
  data?: {latestLedger?: number} | null;
  error?: unknown;
}): number | undefined {
  const ledger = result.data?.latestLedger;
  if (result.error || typeof ledger !== 'number' || !Number.isSafeInteger(ledger) || ledger <= 0) return undefined;
  return ledger;
}

export function RootPaymentListener() {
  // This component is deliberately mounted beside the root navigator so it can
  // keep listening across every customer screen. `useNavigationState` cannot be
  // used there: it requires a child navigator context. The container ref is
  // available from NavigationContainer and emits a state event for every root
  // route transition, including leaving Main for Scan or Confirm.
  const navigation = useNavigation<NavigationContainerRef<RootStackParams>>();
  const [routeName, setRouteName] = React.useState<keyof RootStackParams | undefined>(() =>
    navigation.getCurrentRoute()?.name as keyof RootStackParams | undefined,
  );

  React.useEffect(() => {
    const refreshRoute = () => {
      setRouteName(navigation.getCurrentRoute()?.name as keyof RootStackParams | undefined);
    };
    refreshRoute();
    const unsubscribeState = navigation.addListener('state', refreshRoute);
    const unsubscribeReady = navigation.addListener('ready', refreshRoute);
    return () => {
      unsubscribeState();
      unsubscribeReady();
    };
  }, [navigation]);

  const locked = useAppStore(state => state.locked);
  const active = shouldListenInForeground(routeName, locked);
  const stellarHealth = useStellarHealth(active);

  const refreshLedger = React.useCallback(async () => {
    const result = await stellarHealth.refetch();
    return freshLedgerFromRefetch(result);
  }, [stellarHealth]);

  return (
    <ForegroundPaymentListener
      active={active}
      latestLedger={stellarHealth.data?.latestLedger}
      refreshLedger={refreshLedger}
      navigation={navigation}
    />
  );
}

/**
 * There is no tab bar. Paying and looking back at what you paid is the whole
 * job, and both live on one screen, so a bar promising three destinations was
 * three doors into the same room.
 */
export function RootNavigator() {
  // A returning session skips onboarding and lands where the user left off.
  const returning = useAppStore(hasRestorableSession);
  const t = useTranslate();

  return (
    <Stack.Navigator
      initialRouteName={returning ? 'Main' : 'Welcome'}
      screenOptions={{
        contentStyle: {backgroundColor: colors.canvas},
        headerShadowVisible: false,
        headerStyle: {backgroundColor: colors.canvas},
        headerTintColor: colors.ink,
        // Native-driven transitions keep the route motion consistent with the
        // lighter content entrance handled by Screen.
        animation: 'slide_from_right',
        animationDuration: 320,
        animationTypeForReplace: 'push',
      }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{headerShown: false, animation: 'fade'}} />
      <Stack.Screen name="CreateAccount" component={CreateAccountScreen} options={{title: t('Set up your account'), headerBackTitle: t('Go back')}} />
      <Stack.Screen
        name="RecoveryPhrase"
        component={RecoveryPhraseScreen}
        options={{title: t('Recovery phrase'), headerBackTitle: t('Go back')}}
      />
      <Stack.Screen
        name="ImportWallet"
        component={ImportWalletScreen}
        options={{title: t('Restore your wallet'), headerBackTitle: t('Go back')}}
      />
      <Stack.Screen
        name="RecoverWallet"
        component={RecoverWalletScreen}
        options={{title: t('Recover your wallet'), headerBackTitle: t('Go back')}}
      />
      <Stack.Screen name="Main" component={MainTabs} options={{headerShown: false, animation: 'fade'}} />
    <Stack.Screen name="LiraDeposit" component={LiraDepositScreen} options={{title: t('Add lira'), headerBackTitle: t('Go back')}} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{title: t('Scan QR'), animation: 'fade_from_bottom'}} />
      <Stack.Screen name="Confirm" component={PaymentConfirmationScreen} options={{title: t('Review payment'), animation: 'slide_from_bottom'}} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{title: t('Receipt'), headerBackVisible: false, animation: 'fade'}} />
      <Stack.Screen name="DeveloperSettings" component={DeveloperSettingsScreen} options={{title: t('Developer settings')}} />
      <Stack.Screen
        name="MerchantOnboarding"
        component={MerchantOnboardingScreen}
        options={{title: t('Business profile'), animation: 'slide_from_bottom'}}
      />
      <Stack.Screen
        name="MerchantRequest"
        component={MerchantRequestScreen}
        options={{title: t('Payment request'), animation: 'slide_from_right'}}
      />
      <Stack.Screen name="AnchorTransfer" component={AnchorTransferScreen} options={{title: t('Anchor transfer')}} />
    </Stack.Navigator>
  );
}
