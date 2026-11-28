import { Fragment, Suspense, lazy, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { getScreenCatalog, type Market, type MobileUser } from "../api";
import { registerDeviceNotifications } from "../deviceSecurity";
import { colors, hapticSelection, radius, spacing } from "../design/tokens";
import { DiscoverHub } from "../features/discover/DiscoverHub";
import { HomeScreen } from "../features/home/HomeScreen";
import { MoreHub } from "../features/more/MoreHub";
import { PortfolioHub } from "../features/portfolio/PortfolioHub";
import { MOBILE_FEATURES, supportedMobileFeatures, type MobileFeatureEntry } from "../features/registry";
import { StrategiesHub } from "../features/strategies/StrategiesHub";
import {
  DESTINATIONS,
  featuresForDestination,
  type DeepLinkTarget,
  type DestinationKey,
} from "./navigation";

const LazyNewsSwing = lazy(() => import("../features/NewsSwing"));
const LazyTradeLedger = lazy(() => import("../features/TradeLedger"));
const LazyServerCardScreen = lazy(() => import("../features/ServerCardScreen"));

const CenteredLoader = () => (
  <View style={styles.center}>
    <ActivityIndicator color={colors.emerald} />
  </View>
);

export function AppShell({
  user,
  market,
  onMarketChange,
  deepLink,
  onDeepLinkHandled,
  onLogout,
}: {
  user: MobileUser;
  market: Market;
  onMarketChange: (market: Market) => void;
  deepLink: DeepLinkTarget | null;
  onDeepLinkHandled: () => void;
  onLogout: () => void;
}) {
  const [destination, setDestination] = useState<DestinationKey>("home");
  const [discoverKey, setDiscoverKey] = useState("stock-screener");
  const [strategyKey, setStrategyKey] = useState("strong-swing");
  const [screens, setScreens] = useState<MobileFeatureEntry[]>(MOBILE_FEATURES);
  const [notificationStatus, setNotificationStatus] = useState("");

  useEffect(() => {
    void getScreenCatalog()
      .then((result) => {
        const supported = supportedMobileFeatures(result.screens);
        if (supported.length) setScreens(supported);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void registerDeviceNotifications()
      .then(setNotificationStatus)
      .catch(() => setNotificationStatus("Push registration is temporarily unavailable."));
  }, []);

  const activeDestination = deepLink?.destination ?? destination;
  const activeDiscoverKey = deepLink?.destination === "discover" && deepLink.screenKey ? deepLink.screenKey : discoverKey;
  const activeStrategyKey = deepLink?.destination === "strategies" && deepLink.screenKey ? deepLink.screenKey : strategyKey;

  const selectDestination = (next: DestinationKey) => {
    if (next !== activeDestination) hapticSelection();
    setDestination(next);
    if (deepLink) onDeepLinkHandled();
  };

  const renderFeature = (feature: MobileFeatureEntry) => {
    if (feature.kind === "native" && feature.key === "news-swing") {
      return (
        <Fragment key={`news-swing:${market}`}>
          <Suspense fallback={<CenteredLoader />}>
            <LazyNewsSwing market={market} />
          </Suspense>
        </Fragment>
      );
    }
    if (feature.kind === "native" && feature.key === "trade-ledger") {
      return (
        <Fragment key={`trade-ledger:${market}`}>
          <Suspense fallback={<CenteredLoader />}>
            <LazyTradeLedger market={market} />
          </Suspense>
        </Fragment>
      );
    }
    return (
      <Suspense key={`${feature.key}:${market}`} fallback={<CenteredLoader />}>
        <LazyServerCardScreen screenKey={feature.key} title={feature.title} market={market} />
      </Suspense>
    );
  };

  const navigateTo = (nextDestination: DestinationKey, screenKey?: string) => {
    setDestination(nextDestination);
    if (nextDestination === "discover" && screenKey) setDiscoverKey(screenKey);
    if (nextDestination === "strategies" && screenKey) setStrategyKey(screenKey);
    if (deepLink) onDeepLinkHandled();
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.brand}>
          Investo<Text style={styles.accent}>Genie</Text>
        </Text>
        <View style={styles.marketSwitch}>
          {(["IN", "US"] as Market[]).map((value) => {
            const active = market === value;
            return (
              <Pressable
                key={value}
                onPress={() => {
                  if (!active) hapticSelection();
                  onMarketChange(value);
                  if (deepLink) navigateTo(activeDestination, deepLink.screenKey);
                }}
                style={[styles.marketBtn, active && styles.marketBtnActive]}
              >
                <Text style={active ? styles.marketTextActive : styles.marketText}>
                  {value === "IN" ? "IN" : "US"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.flex}>
        {activeDestination === "home" && <HomeScreen market={market} onNavigate={navigateTo} />}
        {activeDestination === "discover" && (
          <DiscoverHub
            market={market}
            features={featuresForDestination(screens, "discover")}
            selectedKey={activeDiscoverKey}
            onSelectKey={(key) => {
              setDiscoverKey(key);
              if (deepLink) onDeepLinkHandled();
            }}
            renderFeature={renderFeature}
          />
        )}
        {activeDestination === "strategies" && (
          <StrategiesHub
            market={market}
            features={featuresForDestination(screens, "strategies")}
            selectedKey={activeStrategyKey}
            onSelectKey={(key) => {
              setStrategyKey(key);
              if (deepLink) onDeepLinkHandled();
            }}
            renderFeature={renderFeature}
          />
        )}
        {activeDestination === "portfolio" && (
          <PortfolioHub
            market={market}
            features={featuresForDestination(screens, "portfolio")}
            renderFeature={renderFeature}
          />
        )}
        {activeDestination === "more" && (
          <MoreHub
            user={user}
            market={market}
            notificationStatus={notificationStatus}
            features={featuresForDestination(screens, "more")}
            onLogout={onLogout}
            renderFeature={renderFeature}
          />
        )}
      </View>

      <View style={styles.bottomBar}>
        {DESTINATIONS.map((item) => {
          const active = activeDestination === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => selectDestination(item.key)}
              style={styles.navItem}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.navGlyph, active && styles.navActive]}>{item.glyph}</Text>
              <Text style={[styles.navLabel, active && styles.navActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg + 2,
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bg,
  },
  brand: { color: colors.text, fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  accent: { color: colors.emerald },
  marketSwitch: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: 3,
    gap: 2,
  },
  marketBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  marketBtnActive: {
    backgroundColor: colors.emeraldBg,
  },
  marketText: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
  marketTextActive: { color: colors.emeraldText, fontSize: 11, fontWeight: "900" },
  bottomBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 6,
    paddingBottom: 6,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    gap: 3,
  },
  navGlyph: { color: colors.textSubtle, fontSize: 16, fontWeight: "700" },
  navLabel: { color: colors.textSubtle, fontSize: 10, fontWeight: "800" },
  navActive: { color: colors.emeraldText },
});
