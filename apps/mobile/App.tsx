import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {NavigationContainer} from '@react-navigation/native';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {colors} from '@rosapay/ui';

import {AppErrorBoundary} from './src/app/AppErrorBoundary';
import {RootNavigator} from './src/app/navigation';

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {retry: false},
    queries: {retry: 2, staleTime: 15_000},
  },
});

function App() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </QueryClientProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

export default App;
