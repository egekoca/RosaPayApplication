import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useNavigation, type NavigationProp} from '@react-navigation/native';
import {UserRound, WalletCards} from 'lucide-react-native';
import {colors} from '@rosapay/ui';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';

import {HomeScreen} from '../features/home/HomeScreen';
import {AnchorTransferScreen} from '../features/wallet/AnchorTransferScreen';
import {LiraDepositScreen} from '../features/wallet/LiraDepositScreen';
import {WelcomeScreen} from '../features/onboarding/WelcomeScreen';
import {CreateAccountScreen} from '../features/onboarding/CreateAccountScreen';
import {RecoveryPhraseScreen} from '../features/onboarding/RecoveryPhraseScreen';
import {ImportWalletScreen} from '../features/onboarding/ImportWalletScreen';
import {ScanScreen} from '../features/payments/ScanScreen';
import {PaymentConfirmationScreen} from '../features/payments/PaymentConfirmationScreen';
import {ReceiptScreen} from '../features/payments/ReceiptScreen';
import {DeveloperSettingsScreen} from '../features/settings/DeveloperSettingsScreen';
import {ProfileScreen} from '../features/profile/ProfileScreen';
import {useTranslate} from '../shared/i18n';
import {MerchantOnboardingScreen} from '../features/merchant/MerchantOnboardingScreen';
import {MerchantRequestScreen} from '../features/merchant/MerchantRequestScreen';
import {hasRestorableSession, useAppStore, type LocalReceipt} from '../state/appStore';

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
  Main: undefined;
  /** Buying USDC with lira, through the anchor's SEP-6 door. */
  LiraDeposit: undefined;
  Scan: undefined;
  Confirm: {payload: SignedPaymentIntentV1};
  Receipt: {receipt: LocalReceipt};
  DeveloperSettings: undefined;
  MerchantOnboarding: undefined;
  MerchantRequest: undefined;
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

// Hoisted so the tab bar is not handed a new component type on every render,
// which would tear down and rebuild the icon each time the language changes.
const walletIcon = ({color}: {color: string}) => <WalletCards color={color} size={22} />;
const profileIcon = ({color}: {color: string}) => <UserRound color={color} size={22} />;

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
      <Stack.Screen name="Main" component={MainTabs} options={{headerShown: false, animation: 'fade'}} />
    <Stack.Screen name="LiraDeposit" component={LiraDepositScreen} options={{title: t('Add lira'), headerBackTitle: t('Go back')}} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{title: t('Scan QR'), animation: 'fade_from_bottom'}} />
      <Stack.Screen name="Confirm" component={PaymentConfirmationScreen} options={{title: t('Review payment'), animation: 'slide_from_bottom'}} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{title: t('Receipt'), headerBackVisible: false, animation: 'fade'}} />
      <Stack.Screen name="DeveloperSettings" component={DeveloperSettingsScreen} options={{title: t('Developer settings')}} />
      <Stack.Screen
        name="MerchantOnboarding"
        component={MerchantOnboardingScreen}
        options={{title: 'Business profile', animation: 'slide_from_bottom'}}
      />
      <Stack.Screen
        name="MerchantRequest"
        component={MerchantRequestScreen}
        options={{title: t('Payment request'), animation: 'slide_from_right'}}
      />
      <Stack.Screen name="AnchorTransfer" component={AnchorTransferScreen} options={{title: 'Anchor transfer'}} />
    </Stack.Navigator>
  );
}
