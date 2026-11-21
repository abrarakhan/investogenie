import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Market } from "../../api";
import type { DestinationKey } from "../../app/navigation";
import { colors, hapticSelection, radius, spacing } from "../../design/tokens";
import ServerCardScreen from "../ServerCardScreen";

export function HomeScreen({
  market,
  onNavigate,
}: {
  market: Market;
  onNavigate: (destination: DestinationKey, screenKey?: string) => void;
}) {
  const shortcuts: Array<{ label: string; destination: DestinationKey; screenKey?: string }> =
    market === "IN"
      ? [
          { label: "Mid-Way", destination: "strategies", screenKey: "trend-continuation" },
          { label: "Strong Swing", destination: "strategies", screenKey: "strong-swing" },
          { label: "Screener", destination: "discover", screenKey: "stock-screener" },
          { label: "Ledger", destination: "portfolio", screenKey: "trade-ledger" },
        ]
      : [
          { label: "Strong Swing", destination: "strategies", screenKey: "strong-swing" },
          { label: "Screener", destination: "discover", screenKey: "stock-screener" },
          { label: "Long-Term", destination: "discover", screenKey: "long-term" },
          { label: "Ledger", destination: "portfolio", screenKey: "trade-ledger" },
        ];

  return (
    <View style={styles.flex}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bar}
        contentContainerStyle={styles.row}
      >
        {shortcuts.map((item) => (
          <Pressable
            key={item.label}
            onPress={() => {
              hapticSelection();
              onNavigate(item.destination, item.screenKey);
            }}
            style={({ pressed }) => [styles.shortcut, pressed && styles.shortcutPressed]}
          >
            <Text style={styles.shortcutText}>{item.label} ›</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.flex}>
        <ServerCardScreen
          key={`home:${market}`}
          screenKey="home"
          fallbackScreenKey="market"
          title="Home"
          market={market}
        />
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
  shortcut: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  shortcutPressed: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.emeraldBorder,
  },
  shortcutText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
});
