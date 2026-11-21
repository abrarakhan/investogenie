import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Market } from "../../api";
import { colors, hapticSelection, radius, spacing } from "../../design/tokens";
import type { MobileFeatureEntry } from "../registry";

export function DiscoverHub({
  features,
  selectedKey,
  onSelectKey,
  renderFeature,
}: {
  market: Market;
  features: MobileFeatureEntry[];
  selectedKey: string;
  onSelectKey: (key: string) => void;
  renderFeature: (feature: MobileFeatureEntry) => ReactNode;
}) {
  const active = features.find((item) => item.key === selectedKey) ?? features[0];
  if (!active) return null;

  return (
    <View style={styles.flex}>
      {features.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bar}
          contentContainerStyle={styles.row}
        >
          {features.map((feature) => {
            const isActive = feature.key === active.key;
            return (
              <Pressable
                key={feature.key}
                onPress={() => {
                  if (!isActive) hapticSelection();
                  onSelectKey(feature.key);
                }}
                style={[styles.pill, isActive && styles.pillActive]}
              >
                <Text style={isActive ? styles.pillTextActive : styles.pillText}>
                  {feature.tabLabel}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.flex}>{renderFeature(active)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillActive: {
    borderColor: colors.emeraldBorder,
    backgroundColor: colors.emeraldBg,
  },
  pillText: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  pillTextActive: { color: colors.emeraldText, fontSize: 12, fontWeight: "900" },
});
