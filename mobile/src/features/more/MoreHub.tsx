import { useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Market, MobileUser } from "../../api";
import { Card } from "../../design/Card";
import { Pill } from "../../design/Pill";
import { colors, radius, spacing, typography } from "../../design/tokens";
import { ScreenHead } from "../../ui";
import type { MobileFeatureEntry } from "../registry";

const configuredWebUrl = (process.env.EXPO_PUBLIC_API_URL?.trim() || "").replace(/\/$/, "");

export function MoreHub({
  user,
  market,
  notificationStatus,
  features,
  onLogout,
  renderFeature,
}: {
  user: MobileUser;
  market: Market;
  notificationStatus: string;
  features: MobileFeatureEntry[];
  onLogout: () => void;
  renderFeature: (feature: MobileFeatureEntry) => ReactNode;
}) {
  const [openFeature, setOpenFeature] = useState<MobileFeatureEntry | null>(null);

  if (openFeature) {
    return (
      <View style={styles.flex}>
        <Pressable onPress={() => setOpenFeature(null)} style={styles.backBar}>
          <Text style={styles.link}>‹ Back to More</Text>
        </Pressable>
        <View style={styles.flex}>{renderFeature(openFeature)}</View>
      </View>
    );
  }

  const openWebSettings = () => {
    if (!/^https:\/\//.test(configuredWebUrl)) return;
    void Linking.openURL(`${configuredWebUrl}/settings`).catch(() => undefined);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ScreenHead title="More" subtitle="Account, notifications, and broker settings." />

      <View style={styles.section}>
        <Card>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Account</Text>
              <Text style={styles.muted}>{user.email}</Text>
            </View>
            <Pill label={market === "IN" ? "India · NSE" : "US Market"} tone="research" compact />
          </View>
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Notifications</Text>
          <Text style={styles.muted}>
            {notificationStatus || "Device push alerts are active for execution-ready signals and ledger events."}
          </Text>
        </Card>

        <Card onPress={/^https:\/\//.test(configuredWebUrl) ? openWebSettings : undefined}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Broker Connection (ICICI Breeze)</Text>
              <Text style={styles.muted}>
                Broker credentials and daily session tokens are managed securely on the web terminal.
              </Text>
            </View>
            {/^https:\/\//.test(configuredWebUrl) && <Text style={styles.link}>Manage on Web ↗</Text>}
          </View>
        </Card>

        {features.map((feature) => (
          <Card key={feature.key} onPress={() => setOpenFeature(feature)}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{feature.title}</Text>
              <Text style={styles.link}>Open ›</Text>
            </View>
          </Card>
        ))}

        <Pressable onPress={onLogout} style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}>
          <Text style={styles.signOutText}>Sign out &amp; clear local cache</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { paddingBottom: spacing.xxl },
  section: { paddingHorizontal: spacing.lg, gap: spacing.md },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  muted: typography.muted,
  link: { color: colors.link, fontSize: 12, fontWeight: "800" },
  backBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  signOut: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.roseBorder,
    backgroundColor: colors.roseBg,
    borderRadius: radius.md,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutPressed: { opacity: 0.85 },
  signOutText: { color: colors.roseText, fontSize: 14, fontWeight: "800" },
});
