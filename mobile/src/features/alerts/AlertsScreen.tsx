import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import {
  getAlertPreferences, updateAlertPreferences, type MobileAlertPreferences,
} from "../../api";
import { Card } from "../../design/Card";
import { colors, hapticSelection, hapticWarning, spacing, typography } from "../../design/tokens";
import { errorMessage } from "../../format";
import { Banner, ScreenHead } from "../../ui";

type PrefKey = keyof Omit<MobileAlertPreferences, "updatedAt">;

const ROWS: Array<{ key: PrefKey; title: string; detail: string }> = [
  { key: "executionReady", title: "Execution-ready signals", detail: "Push alert when a Strong Swing, Momentum, or Continuation setup passes all execution gates." },
  { key: "midwaySetups", title: "Mid-Way setups", detail: "Notify on Stage-2 Impulse, EP Rebound, 3D Stair-Step, and VDU Pause qualifications." },
  { key: "ledgerRiskAlerts", title: "Open-trade stop & exit alerts", detail: "Notify when an open ledger position triggers a stop breach or revised exit action." },
  { key: "newsHighImpact", title: "High-impact news", detail: "Material disclosures or earnings catalysts affecting tracked stocks." },
  { key: "quietHoursEnabled", title: "Quiet hours (after market close)", detail: "Mute non-critical alerts outside active market sessions." },
];

export function AlertsScreen() {
  const [prefs, setPrefs] = useState<MobileAlertPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<PrefKey | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAlertPreferences()
      .then((result) => { if (active) setPrefs(result.preferences); })
      .catch((cause) => { if (active) setError(errorMessage(cause, "Could not load alert preferences")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const toggle = async (key: PrefKey, value: boolean) => {
    if (!prefs || savingKey) return;
    hapticSelection();
    setSavingKey(key);
    setError("");
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const result = await updateAlertPreferences({ [key]: value });
      setPrefs(result.preferences);
    } catch (cause) {
      hapticWarning();
      setPrefs(previous);
      setError(errorMessage(cause, "Could not save preference"));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHead title="Alert Preferences" subtitle="Server-enforced notification routing for your account." />
      {!!error && <Banner>{error}</Banner>}
      {loading && !prefs ? (
        <View style={styles.center}><ActivityIndicator color={colors.emerald} /></View>
      ) : prefs ? (
        <View style={styles.list}>
          {ROWS.map((row) => (
            <Card key={row.key}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.title}>{row.title}</Text>
                  <Text style={styles.detail}>{row.detail}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  disabled={savingKey === row.key}
                  onValueChange={(next) => { void toggle(row.key, next); }}
                  trackColor={{ false: colors.borderStrong, true: colors.emeraldBorder }}
                  thumbColor={prefs[row.key] ? colors.emerald : colors.textMuted}
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { paddingBottom: spacing.xxl },
  center: { paddingVertical: 48, alignItems: "center" },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  title: { color: colors.text, fontSize: 15, fontWeight: "800" },
  detail: { ...typography.muted, marginTop: 3 },
});
