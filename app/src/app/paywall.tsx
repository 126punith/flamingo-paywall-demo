import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import { MockScenarioPicker } from '@/components/MockScenarioPicker';
import { PlanCard } from '@/components/PlanCard';
import { LEGAL_URLS } from '@/config';
import { useIsPremium } from '@/entitlements/store';
import { isMockStore } from '@/iap/adapter';
import { usePurchase } from '@/iap/IAPProvider';
import { yearlySavingsPercent } from '@/iap/products';
import { colors, radius } from '@/theme';

const BENEFITS = [
  { icon: '💬', text: 'Unlimited question decks for every stage of your relationship' },
  { icon: '🌙', text: 'Date night ideas and couple challenges, refreshed weekly' },
  { icon: '📔', text: 'Shared journal and memories, synced across both phones' },
  { icon: '✨', text: 'No ads, ever' },
];

const STATUS_LABEL = {
  purchasing: 'Opening store…',
  verifying: 'Confirming your purchase…',
  restoring: 'Restoring purchases…',
  pending: 'Waiting for approval…',
} as const;

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function PaywallScreen() {
  const { source = 'direct' } = useLocalSearchParams<{ source?: string }>();
  const { plans, status, error, purchase, restore, reloadPlans, clearError } = usePurchase();
  const isPremium = useIsPremium();
  const [wasPremiumOnOpen] = useState(isPremium);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = plans.find((p) => p.productId === selectedId) ?? plans[0];
  const savings = useMemo(() => yearlySavingsPercent(plans), [plans]);
  const busy = status !== 'idle';

  useEffect(() => {
    track('paywall_view', { source, variant: 'default' });
  }, [source]);

  useEffect(() => {
    if (isPremium && !wasPremiumOnOpen) router.replace('/premium');
  }, [isPremium, wasPremiumOnOpen]);

  const onSelect = (productId: string) => {
    setSelectedId(productId);
    track('plan_select', { productId });
  };

  const onRestore = async () => {
    track('restore_tap');
    const found = await restore();
    if (!found) Alert.alert('No subscription found', 'We could not find an active subscription for this account.');
  };

  if (wasPremiumOnOpen && isPremium) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.title}>You&apos;re Premium 💖</Text>
        <Pressable style={styles.cta} onPress={close}>
          <Text style={styles.ctaText}>Done</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const ctaLabel = selected?.trial ? `Start ${selected.trial.label}` : 'Continue';
  const priceLine = selected
    ? selected.trial
      ? `${selected.trial.days} days free, then ${selected.displayPrice}/${selected.period}. Cancel anytime.`
      : `${selected.displayPrice}/${selected.period}. Cancel anytime.`
    : '';
  const storeName = Platform.OS === 'android' ? 'Google Play account' : 'Apple Account';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Pressable accessibilityLabel="Close" hitSlop={16} onPress={close} style={styles.close} disabled={busy}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hero}>🦩</Text>
        <Text style={styles.title}>Grow closer with Flamingo Premium</Text>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b.text} style={styles.benefitRow}>
              <Text style={styles.benefitIcon}>{b.icon}</Text>
              <Text style={styles.benefitText}>{b.text}</Text>
            </View>
          ))}
        </View>

        {status === 'loading' ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} />
        ) : plans.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>Plans are unavailable right now.</Text>
            <Pressable onPress={reloadPlans}>
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.plans} accessibilityRole="radiogroup">
            {plans.map((plan) => (
              <PlanCard
                key={plan.productId}
                plan={plan}
                selected={plan.productId === selected?.productId}
                savingsPercent={savings}
                onPress={() => onSelect(plan.productId)}
              />
            ))}
          </View>
        )}

        {error && (
          <Pressable onPress={clearError} style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        )}

        {isMockStore && <MockScenarioPicker />}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.cta, (busy || !selected) && styles.ctaDisabled]}
          disabled={busy || !selected}
          onPress={() => selected && purchase(selected)}>
          {busy && status !== 'loading' ? (
            <View style={styles.row}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.ctaText}>{STATUS_LABEL[status as keyof typeof STATUS_LABEL]}</Text>
            </View>
          ) : (
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          )}
        </Pressable>
        <Text style={styles.priceLine}>{priceLine}</Text>

        <View style={styles.links}>
          <Pressable onPress={onRestore} disabled={busy}>
            <Text style={styles.link}>Restore Purchases</Text>
          </Pressable>
          <Text style={styles.muted}>·</Text>
          <Pressable onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.terms)}>
            <Text style={styles.link}>Terms</Text>
          </Pressable>
          <Text style={styles.muted}>·</Text>
          <Pressable onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.privacy)}>
            <Text style={styles.link}>Privacy</Text>
          </Pressable>
        </View>
        <Text style={styles.legal}>
          Payment is charged to your {storeName} at confirmation of purchase
          {selected?.trial ? ' or when the free trial ends' : ''}. The subscription renews automatically unless
          cancelled at least 24 hours before the end of the current period. Manage or cancel in your account settings.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  close: { position: 'absolute', top: 56, right: 20, zIndex: 1 },
  closeText: { fontSize: 20, color: colors.textMuted },
  content: { padding: 24, paddingTop: 40, gap: 20 },
  hero: { fontSize: 56, textAlign: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center' },
  benefits: { gap: 12 },
  benefitRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  benefitIcon: { fontSize: 22 },
  benefitText: { flex: 1, fontSize: 15, color: colors.text, lineHeight: 20 },
  plans: { gap: 16, marginTop: 8 },
  error: { backgroundColor: '#FDECEC', borderRadius: radius.sm, padding: 12 },
  errorText: { color: colors.danger, textAlign: 'center' },
  footer: { paddingHorizontal: 24, paddingBottom: 8, gap: 8 },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  priceLine: { textAlign: 'center', color: colors.text, fontSize: 13 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  link: { color: colors.primaryDark, fontSize: 13, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 13 },
  legal: { color: colors.textMuted, fontSize: 10, textAlign: 'center', lineHeight: 14 },
});
