import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {NavigationContainer} from '@react-navigation/native';
import {StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {colors} from '@rosapay/ui';

import {AppErrorBoundary} from './src/app/AppErrorBoundary';
import {RootNavigator} from './src/app/navigation';
import {useAutoLock} from './src/app/useAutoLock';
import {UnlockScreen} from './src/features/onboarding/UnlockScreen';
import {LumenadeLoader} from './src/shared/LumenadeMark';
import {useAppStore} from './src/state/appStore';

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {retry: false},
    queries: {retry: 2, staleTime: 15_000},
  },
});

function App() {
  // The stored session is read back asynchronously; showing the navigator before
  // it lands would send a returning user through onboarding again.
  const hydrated = useAppStore(state => state.hydrated);
  const locked = useAppStore(state => state.locked);
  useAutoLock();

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
          {hydrated && locked ? (
            // The lock stands in for the app rather than covering it, so a
            // locked session mounts no screen that could hold someone's money
            // on it. Unlocking mounts the app fresh at its own first route.
            <UnlockScreen />
          ) : hydrated ? (
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          ) : (
            <View style={styles.splash}>
              <LumenadeLoader label="Preparing your wallet" />
            </View>
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  splash: {alignItems: 'center', backgroundColor: colors.canvas, flex: 1, justifyContent: 'center'},
});

export default App;
