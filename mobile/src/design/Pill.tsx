import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "./tokens";

export type PillTone = "positive" | "warning" | "negative" | "research" | "neutral";

export function Pill({ label, tone = "neutral", compact = false }: { label: string; tone?: PillTone; compact?: boolean }) {
  const palette = TONE_STYLES[tone];
  return (
    <View style={[styles.pill, compact && styles.compact, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.text, compact && styles.compactText, { color: palette.text }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const TONE_STYLES: Record<PillTone, { bg: string; border: string; text: string }> = {
  positive: { bg: colors.emeraldBg, border: colors.emeraldBorder, text: colors.emeraldText },
  warning: { bg: colors.amberBg, border: colors.amberBorder, text: colors.amber },
  negative: { bg: colors.roseBg, border: colors.roseBorder, text: colors.roseText },
  research: { bg: colors.violetBg, border: colors.violetBorder, text: colors.violetText },
  neutral: { bg: colors.surfaceInset, border: colors.borderStrong, text: colors.textSecondary },
};

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  compact: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  text: {
    fontSize: 9.5,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  compactText: {
    fontSize: 9,
  },
});
