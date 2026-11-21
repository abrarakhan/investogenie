import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "./design/EmptyState";
import { MetricTile } from "./design/Metric";
import { colors, radius, spacing, typography } from "./design/tokens";

export function Action({
  label,
  onPress,
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, disabled && styles.disabled]}
      onPress={onPress}
      disabled={busy || disabled}
    >
      {busy ? <ActivityIndicator color={colors.emeraldInk} /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

export function ScreenHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.screenHead}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.muted}>{subtitle}</Text>
    </View>
  );
}

export function Metric({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <MetricTile
      label={label}
      value={value}
      tone={positive ? "positive" : negative ? "negative" : "neutral"}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <EmptyState message={children} />;
}

export function Banner({ children }: { children: ReactNode }) {
  return <Text style={styles.errorBanner}>{children}</Text>;
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: colors.emerald,
    borderRadius: radius.md,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.xs,
  },
  primaryPressed: { opacity: 0.88 },
  disabled: { opacity: 0.45 },
  primaryText: { color: colors.emeraldInk, fontSize: 15, fontWeight: "900" },
  screenHead: { paddingHorizontal: spacing.lg + 2, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: 4 },
  title: typography.screenTitle,
  muted: typography.muted,
  errorBanner: {
    color: colors.roseText,
    backgroundColor: colors.roseBg,
    borderColor: colors.roseBorder,
    borderWidth: 1,
    marginHorizontal: spacing.lg + 2,
    marginBottom: spacing.sm + 2,
    padding: spacing.md,
    borderRadius: radius.sm + 1,
    overflow: "hidden",
  },
});
