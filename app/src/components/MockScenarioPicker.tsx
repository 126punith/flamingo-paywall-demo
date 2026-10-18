import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getMockScenario, setMockScenario, type MockScenario } from '@/iap/mockAdapter';
import { colors, radius } from '@/theme';

const SCENARIOS: MockScenario[] = ['success', 'cancel', 'pending', 'error'];

/** Demo-only control for simulating store outcomes without sandbox accounts. */
export function MockScenarioPicker() {
  const [current, setCurrent] = useState(getMockScenario());

  return (
    <View style={styles.box}>
      <Text style={styles.label}>Mock store outcome</Text>
      <View style={styles.row}>
        {SCENARIOS.map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              setMockScenario(s);
              setCurrent(s);
            }}
            style={[styles.chip, current === s && styles.chipOn]}>
            <Text style={[styles.chipText, current === s && styles.chipTextOn]}>{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 12,
    gap: 8,
  },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '700' },
});
