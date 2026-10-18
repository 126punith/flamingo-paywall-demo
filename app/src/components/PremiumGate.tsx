import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useEntitlementHydrated, useIsPremium } from '@/entitlements/store';
import { colors } from '@/theme';

/** Renders children for premium users; everyone else is sent to the paywall. */
export function PremiumGate({ children }: { children: ReactNode }) {
  const hydrated = useEntitlementHydrated();
  const isPremium = useIsPremium();

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!isPremium) return <Redirect href={{ pathname: '/paywall', params: { source: 'premium_gate' } }} />;
  return <>{children}</>;
}
