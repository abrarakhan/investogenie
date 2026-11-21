import { useEffect, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";

export function CardListSkeleton({ count = 4 }: { count?: number }) {
  const [opacity] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, index) => (
        <Animated.View key={index} style={[styles.card, { opacity }]}>
          <View style={styles.rowBetween}>
            <View style={styles.titleBlock}>
              <View style={[styles.bar, styles.titleBar]} />
              <View style={[styles.bar, styles.subBar]} />
            </View>
            <View style={styles.pill} />
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metricBox} />
            <View style={styles.metricBox} />
            <View style={styles.metricBox} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 14, gap: 10 },
  card: { backgroundColor: "#0b0f14", borderColor: "#1d232b", borderWidth: 1, borderRadius: 8, padding: 15, gap: 14 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  titleBlock: { flex: 1, gap: 6 },
  bar: { backgroundColor: "#171d26", borderRadius: 4 },
  titleBar: { height: 18, width: "42%" },
  subBar: { height: 11, width: "68%" },
  pill: { height: 26, width: 64, borderRadius: 13, backgroundColor: "#171d26" },
  metricRow: { flexDirection: "row", gap: 8 },
  metricBox: { flex: 1, height: 48, borderRadius: 6, backgroundColor: "#0f141c" },
});
