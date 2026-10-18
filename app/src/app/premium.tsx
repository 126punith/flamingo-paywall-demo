import { StyleSheet, Text, View } from 'react-native';

import { PremiumGate } from '@/components/PremiumGate';
import { colors, radius } from '@/theme';

const QUESTIONS = [
  'What is a small thing I do that makes you feel loved?',
  'Where do you see us in five years?',
  'What is a memory of us you replay often?',
];

export default function PremiumScreen() {
  return (
    <PremiumGate>
      <View style={styles.content}>
        <Text style={styles.title}>Deep talks 💬</Text>
        {QUESTIONS.map((q) => (
          <View key={q} style={styles.card}>
            <Text style={styles.q}>{q}</Text>
          </View>
        ))}
      </View>
    </PremiumGate>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 20 },
  q: { fontSize: 17, color: colors.text, lineHeight: 24 },
});
