import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {CircleUserRound, History, House} from 'lucide-react-native';
import {colors} from '@rosapay/ui';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';

import {ActivityScreen} from '../features/activity/ActivityScreen';
import {HomeScreen} from '../features/home/HomeScreen';
import {WalletScreen} from '../features/wallet/WalletScreen';
import {WelcomeScreen} from '../features/onboarding/WelcomeScreen';
import {ScanScreen} from '../features/payments/ScanScreen';
import {PaymentConfirmationScreen} from '../features/payments/PaymentConfirmationScreen';
import {ReceiptScreen} from '../features/payments/ReceiptScreen';
import {MerchantRequestScreen} from '../features/merchant/MerchantRequestScreen';
import type {LocalReceipt} from '../state/appStore';

export type RootStackParams = {
  Welcome: undefined;
  Main: undefined;
  Scan: undefined;
  Confirm: {payload: SignedPaymentIntentV1};
  Receipt: {receipt: LocalReceipt};
  MerchantRequest: undefined;
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
  return (
    <Stack.Navigator
      initialRouteName="Welcome"
      screenOptions={{
        contentStyle: {backgroundColor: colors.canvas},
        headerShadowVisible: false,
        headerStyle: {backgroundColor: colors.canvas},
        headerTintColor: colors.ink,
      }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{headerShown: false}} />
      <Stack.Screen name="Main" component={MainTabs} options={{headerShown: false}} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{title: 'Scan QR'}} />
      <Stack.Screen name="Confirm" component={PaymentConfirmationScreen} options={{title: 'Review payment'}} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{title: 'Receipt', headerBackVisible: false}} />
      <Stack.Screen name="MerchantRequest" component={MerchantRequestScreen} options={{title: 'Payment request'}} />
    </Stack.Navigator>
  );
}
