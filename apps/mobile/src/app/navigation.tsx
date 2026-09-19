import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {CircleUserRound, History, House} from 'lucide-react-native';
import {colors} from '@rosapay/ui';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';

import {ActivityScreen} from '../features/activity/ActivityScreen';
import {HomeScreen} from '../features/home/HomeScreen';
import {WalletScreen} from '../features/wallet/WalletScreen';
import {AnchorTransferScreen} from '../features/wallet/AnchorTransferScreen';
import {WelcomeScreen} from '../features/onboarding/WelcomeScreen';
import {CreateAccountScreen} from '../features/onboarding/CreateAccountScreen';
import {ScanScreen} from '../features/payments/ScanScreen';
import {PaymentConfirmationScreen} from '../features/payments/PaymentConfirmationScreen';
import {ReceiptScreen} from '../features/payments/ReceiptScreen';
import {DeveloperSettingsScreen} from '../features/settings/DeveloperSettingsScreen';
import {MerchantOnboardingScreen} from '../features/merchant/MerchantOnboardingScreen';
import {MerchantRequestScreen} from '../features/merchant/MerchantRequestScreen';
import {hasRestorableSession, useAppStore, type LocalReceipt} from '../state/appStore';

export type RootStackParams = {
  Welcome: undefined;
  CreateAccount: undefined;
  Main: undefined;
  Scan: undefined;
  Confirm: {payload: SignedPaymentIntentV1};
  Receipt: {receipt: LocalReceipt};
  DeveloperSettings: undefined;
  MerchantOnboarding: undefined;
  MerchantRequest: undefined;
  AnchorTransfer: {kind: 'deposit' | 'withdraw'};
};

export type MainTabsParams = {Home: undefined; Activity: undefined; Wallet: undefined};

const Stack = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator<MainTabsParams>();
const tabIcons = {Home: House, Activity: History, Wallet: CircleUserRound} as const;

function TabIcon({routeName, color, size}: {routeName: keyof MainTabsParams; color: string; size: number}) {
  const Icon = tabIcons[routeName];
  return <Icon color={color} size={size} strokeWidth={2} />;
}

const mainTabScreenOptions = ({route}: {route: {name: keyof MainTabsParams}}) => ({
  headerShown: false,
  tabBarActiveTintColor: colors.amber,
  tabBarInactiveTintColor: colors.inkMuted,
  tabBarStyle: {backgroundColor: colors.surface, height: 72, paddingBottom: 10, paddingTop: 8, borderTopColor: colors.line},
  tabBarIcon: ({color, size}: {color: string; size: number}) => (
    <TabIcon routeName={route.name} color={color} size={size} />
  ),
});

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={mainTabScreenOptions}>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Activity" component={ActivityScreen} />
      <Tabs.Screen name="Wallet" component={WalletScreen} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  // A returning session skips onboarding and lands where the user left off.
  const returning = useAppStore(hasRestorableSession);

  return (
    <Stack.Navigator
      initialRouteName={returning ? 'Main' : 'Welcome'}
      screenOptions={{
        contentStyle: {backgroundColor: colors.canvas},
        headerShadowVisible: false,
        headerStyle: {backgroundColor: colors.canvas},
        headerTintColor: colors.ink,
        // Native-driven transitions so they behave identically on iOS and Android.
        animation: 'slide_from_right',
        animationDuration: 260,
        animationTypeForReplace: 'push',
      }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{headerShown: false, animation: 'fade'}} />
      <Stack.Screen name="CreateAccount" component={CreateAccountScreen} options={{title: 'Create account', headerBackTitle: 'Back'}} />
      <Stack.Screen name="Main" component={MainTabs} options={{headerShown: false, animation: 'fade'}} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{title: 'Scan QR', animation: 'fade_from_bottom'}} />
      <Stack.Screen name="Confirm" component={PaymentConfirmationScreen} options={{title: 'Review payment', animation: 'slide_from_bottom'}} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{title: 'Receipt', headerBackVisible: false, animation: 'fade'}} />
      <Stack.Screen name="DeveloperSettings" component={DeveloperSettingsScreen} options={{title: 'Developer settings'}} />
      <Stack.Screen name="MerchantOnboarding" component={MerchantOnboardingScreen} options={{title: 'Business profile'}} />
      <Stack.Screen name="MerchantRequest" component={MerchantRequestScreen} options={{title: 'Payment request'}} />
      <Stack.Screen name="AnchorTransfer" component={AnchorTransferScreen} options={{title: 'Anchor transfer'}} />
    </Stack.Navigator>
  );
}
