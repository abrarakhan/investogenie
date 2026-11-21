import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Market } from "../../api";
import { colors, hapticSelection, radius, spacing } from "../../design/tokens";
import type { MobileFeatureEntry } from "../registry";
import { WatchlistView } from "./WatchlistView";

const WATCHLIST_TAB = { key: "watchlist", tabLabel: "Watchlist" } as const;

export function DiscoverHub({
  market,
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
  const isWatchlist = selectedKey === WATCHLIST_TAB.key;
  const active = features.find((item) => item.key === selectedKey) ?? features[0];
  const tabs: Array<{ key: string; tabLabel: string }> = [
    ...features.map((item) => ({ key: item.key, tabLabel: item.tabLabel })),
    WATCHLIST_TAB,
  ];

  return (
    <View style={styles.flex}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bar}
        contentContainerStyle={styles.row}
      >
        {tabs.map((tab) => {
          const isActive = isWatchlist ? tab.key === WATCHLIST_TAB.key : tab.key === active?.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (!isActive) hapticSelection();
                onSelectKey(tab.key);
              }}
              style={[styles.pill, isActive && styles.pillActive]}
            >
              <Text style={isActive ? styles.pillTextActive : styles.pillText}>
                {tab.tabLabel}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.flex}>
        {isWatchlist ? <WatchlistView market={market} /> : active ? renderFeature(active) : null}
      </View>
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
