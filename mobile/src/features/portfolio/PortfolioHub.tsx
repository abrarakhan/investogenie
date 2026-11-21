import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { Market } from "../../api";
import type { MobileFeatureEntry } from "../registry";

export function PortfolioHub({
  features,
  renderFeature,
}: {
  market: Market;
  features: MobileFeatureEntry[];
  renderFeature: (feature: MobileFeatureEntry) => ReactNode;
}) {
  const active = features.find((item) => item.key === "trade-ledger") ?? features[0];
  if (!active) return null;
  return <View style={styles.flex}>{renderFeature(active)}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
