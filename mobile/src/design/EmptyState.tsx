import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "./tokens";

export function EmptyState({
  title,
  message,
  action,
}: {
  title?: string;
  message: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.container}>
      {!!title && <Text style={styles.title}>{title}</Text>}
      <Text style={styles.message}>{message}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: spacing.lg,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: spacing.sm,
  },
  title: { ...typography.sectionTitle, textAlign: "center" },
  message: { ...typography.muted, textAlign: "center" },
  action: { marginTop: spacing.sm, width: "100%" },
});
