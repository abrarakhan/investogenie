import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "./tokens";

export function MetricTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "warning" | "neutral";
}) {
  const valueColor =
    tone === "positive"
      ? colors.emerald
      : tone === "negative"
        ? colors.rose
        : tone === "warning"
          ? colors.amber
          : colors.text;
  return (
    <View style={styles.tile}>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 88,
    backgroundColor: colors.surfaceInset,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 2,
  },
  label: typography.metricLabel,
  value: { ...typography.metricValue, marginTop: 4 },
});
