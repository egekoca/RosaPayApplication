import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
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


const Stack = createNativeStackNavigator<RootStackParams>();


/**
 * There is no tab bar. Paying and looking back at what you paid is the whole
 * job, and both live on one screen, so a bar promising three destinations was
 * three doors into the same room.
 */
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
      <Stack.Screen name="Main" component={HomeScreen} options={{headerShown: false, animation: 'fade'}} />
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
