import { Pressable, StyleSheet, Text, View } from 'react-native';

import { perMonthLabel } from '@/iap/products';
import type { Plan } from '@/iap/types';
import { colors, radius } from '@/theme';

interface Props {
  plan: Plan;
  selected: boolean;
  savingsPercent: number | null;
  onPress: () => void;
}

export function PlanCard({ plan, selected, savingsPercent, onPress }: Props) {
  const perMonth = perMonthLabel(plan);
  const badge = plan.period === 'year' && savingsPercent ? `SAVE ${savingsPercent}%` : null;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.card, selected && styles.selected]}>
      {badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
      <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.dot} />}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.period}>{plan.period === 'year' ? 'Yearly' : 'Monthly'}</Text>
        {plan.trial ? (
          <Text style={styles.trial}>{plan.trial.label}</Text>
        ) : (
          <Text style={styles.sub}>Billed {plan.period === 'year' ? 'annually' : 'monthly'}</Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.price}>
          {plan.displayPrice}
          <Text style={styles.sub}>/{plan.period === 'year' ? 'yr' : 'mo'}</Text>
        </Text>
        {perMonth && <Text style={styles.sub}>{perMonth}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  badge: {
    position: 'absolute',
    top: -11,
    right: 16,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  period: { fontSize: 17, fontWeight: '700', color: colors.text },
  trial: { fontSize: 13, fontWeight: '600', color: colors.primaryDark, marginTop: 2 },
  sub: { fontSize: 13, color: colors.textMuted, fontWeight: '400' },
  price: { fontSize: 17, fontWeight: '700', color: colors.text },
});
