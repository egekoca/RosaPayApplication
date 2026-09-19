import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {NavigationContainer} from '@react-navigation/native';
import {ActivityIndicator, StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {colors} from '@rosapay/ui';

import {AppErrorBoundary} from './src/app/AppErrorBoundary';
import {RootNavigator} from './src/app/navigation';
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

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
          {hydrated ? (
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          ) : (
            <View style={styles.splash}>
              <ActivityIndicator color={colors.amber} size="large" />
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
