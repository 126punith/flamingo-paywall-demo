import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useEntitlementQuery } from '@/api/queries';
import { getUserId } from '@/auth/session';
import { MAX_OFFLINE_MS, useEntitlementStore, useIsPremium } from '@/entitlements/store';
import { refreshEntitlement } from '@/entitlements/sync';
import { isMockStore } from '@/iap/adapter';
import { usePurchase } from '@/iap/IAPProvider';
import { colors, radius } from '@/theme';

const FREE_DECKS = ['Getting to know you', 'Weekend plans', 'Fun & flirty'];
const PREMIUM_DECKS = ['Deep talks', 'Love languages', 'Future together', 'Spicy'];

export default function HomeScreen() {
  const isPremium = useIsPremium();
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const lastVerifiedAt = useEntitlementStore((s) => s.lastVerifiedAt);
  const { manageSubscriptions } = usePurchase();
  const { isError: serverUnreachable } = useEntitlementQuery();
  const [userId, setUserId] = useState('');

  useEffect(() => {
    getUserId().then(setUserId);
  }, []);

  const openDeck = () =>
    isPremium ? router.push('/premium') : router.push({ pathname: '/paywall', params: { source: 'locked_deck' } });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.status, isPremium && styles.statusPremium]}>
        <Text style={styles.statusTitle}>{isPremium ? 'Premium active 💖' : 'Free plan'}</Text>
        {entitlement?.active && (
          <Text style={styles.small}>
            {entitlement.productId} · {entitlement.inTrial ? 'in trial · ' : ''}
            {entitlement.willRenew ? 'renews' : 'expires'} {new Date(entitlement.expiresAt ?? '').toLocaleDateString()}
          </Text>
        )}
        <Text style={styles.small}>Store: {isMockStore ? 'mock' : 'App Store / Google Play'}</Text>
        <Text style={styles.small} numberOfLines={1}>
          User: {userId}
        </Text>
        {lastVerifiedAt && (
          <Text style={styles.small}>Last verified: {new Date(lastVerifiedAt).toLocaleString()}</Text>
        )}
        {serverUnreachable && (
          <Text style={styles.offline}>
            Offline: using access verified {lastVerifiedAt ? new Date(lastVerifiedAt).toLocaleString() : 'never'}.
            Cached access is honored for up to {MAX_OFFLINE_MS / 3_600_000}h.
          </Text>
        )}
        <View style={styles.row}>
          <Pressable onPress={refreshEntitlement}>
            <Text style={styles.link}>Refresh from server</Text>
          </Pressable>
          {isPremium && (
            <Pressable onPress={manageSubscriptions}>
              <Text style={styles.link}>Manage subscription</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Text style={styles.section}>Free decks</Text>
      {FREE_DECKS.map((d) => (
        <View key={d} style={styles.deck}>
          <Text style={styles.deckText}>{d}</Text>
        </View>
      ))}

      <Text style={styles.section}>Premium decks</Text>
      {PREMIUM_DECKS.map((d) => (
        <Pressable key={d} style={styles.deck} onPress={openDeck}>
          <Text style={styles.deckText}>{d}</Text>
          <Text>{isPremium ? '→' : '🔒'}</Text>
        </Pressable>
      ))}

      {!isPremium && (
        <Link href={{ pathname: '/paywall', params: { source: 'home_banner' } }} asChild>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaText}>Unlock Premium</Text>
          </Pressable>
        </Link>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  status: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusPremium: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  statusTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  small: { fontSize: 12, color: colors.textMuted },
  offline: { fontSize: 12, color: colors.danger, marginTop: 4 },
  row: { flexDirection: 'row', gap: 16, marginTop: 8 },
  link: { color: colors.primaryDark, fontWeight: '600', fontSize: 13 },
  section: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 12 },
  deck: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 16,
  },
  deckText: { fontSize: 15, color: colors.text },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
