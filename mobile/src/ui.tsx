import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export function Action({ label, onPress, busy = false, disabled = false }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return <Pressable style={[styles.primary, disabled && styles.disabled]} onPress={onPress} disabled={busy || disabled}>{busy ? <ActivityIndicator color="#04110d" /> : <Text style={styles.primaryText}>{label}</Text>}</Pressable>;
}

export function ScreenHead({ title, subtitle }: { title: string; subtitle: string }) {
  return <View style={styles.screenHead}><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View>;
}

export function Metric({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={[styles.metricValue, positive && styles.good, negative && styles.bad]}>{value}</Text></View>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <View style={styles.empty}><Text style={styles.muted}>{children}</Text></View>;
}

export function Banner({ children }: { children: ReactNode }) {
  return <Text style={styles.errorBanner}>{children}</Text>;
}

const styles = StyleSheet.create({
  primary: { backgroundColor: "#34d399", borderRadius: 8, minHeight: 52, alignItems: "center", justifyContent: "center", marginVertical: 4 }, disabled: { opacity: 0.45 }, primaryText: { color: "#04110d", fontSize: 15, fontWeight: "900" },
  screenHead: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, gap: 5 }, title: { color: "#f7f8fa", fontSize: 27, fontWeight: "900" }, muted: { color: "#858c95", fontSize: 14, lineHeight: 21 },
  metric: { flex: 1, minWidth: 88, backgroundColor: "#080b0f", borderRadius: 6, padding: 10 }, metricLabel: { color: "#656c75", fontSize: 10, fontWeight: "700" }, metricValue: { color: "#e5e7eb", fontSize: 14, fontWeight: "800", marginTop: 5 }, good: { color: "#34d399" }, bad: { color: "#fb7185" },
  empty: { padding: 50, alignItems: "center" }, errorBanner: { color: "#fecdd3", backgroundColor: "#35131d", marginHorizontal: 18, marginBottom: 10, padding: 12, borderRadius: 7 },
});
