import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { queryClient } from '@/api/queryClient';
import { IAPProvider } from '@/iap/IAPProvider';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <IAPProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.background },
          }}>
          <Stack.Screen name="index" options={{ title: 'Flamingo' }} />
          <Stack.Screen name="premium" options={{ title: 'Premium' }} />
          <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false }} />
        </Stack>
      </IAPProvider>
    </QueryClientProvider>
  );
}
