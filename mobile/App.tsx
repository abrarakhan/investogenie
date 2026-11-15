import { Fragment, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import {
  apiConfigurationError, getScreenCatalog, login, logout, restoreSession,
  type Market, type MobileUser,
} from "./src/api";
import { registerDeviceNotifications, unlockWithBiometrics } from "./src/deviceSecurity";
import { MOBILE_FEATURES, supportedMobileFeatures } from "./src/features/registry";

/** A screen key from the server catalog. */
type Tab = string;
/** Screens with dedicated views here; every other catalog entry renders as server-built cards. */
const NATIVE_SCREENS: Record<string, (props: { market: Market }) => React.JSX.Element> = {
  "news-swing": ({ market }) => <Suspense fallback={<Centered><ActivityIndicator color="#34d399" /></Centered>}><LazyNewsSwing market={market} /></Suspense>,
  "trade-ledger": ({ market }) => <Suspense fallback={<Centered><ActivityIndicator color="#34d399" /></Centered>}><LazyTradeLedger market={market} /></Suspense>,
};
const LazyNewsSwing = lazy(() => import("./src/features/NewsSwing"));
const LazyTradeLedger = lazy(() => import("./src/features/TradeLedger"));
const LazyServerCardScreen = lazy(() => import("./src/features/ServerCardScreen"));
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

export default function App() {
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [user, setUser] = useState<MobileUser | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [requestedTab, setRequestedTab] = useState<Tab | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const unlock = useCallback(async () => setUnlocked(await unlockWithBiometrics()), []);
  // State changes here happen only in callbacks; `retry` resets the boot screen first.
  const boot = useCallback(() => {
    void restoreSession().then(async (restored) => {
      setUser(restored);
      if (restored) setUnlocked(await unlockWithBiometrics());
      else setUnlocked(true);
    }).catch((cause) => {
      // Offline or a server outage: keep the saved session and offer a retry.
      setBootError(message(cause, "InvestoGenie could not be reached."));
    }).finally(() => setBooting(false));
  }, []);
  useEffect(() => { boot(); }, [boot]);
  const retry = () => { setBooting(true); setBootError(""); boot(); };
  useEffect(() => {
    const response = Notifications.addNotificationResponseReceivedListener((notificationResponse) => {
      const screen = notificationResponse.notification.request.content.data?.screen;
      // Choose the tab only. Opening from a notification must still pass the biometric lock.
      setRequestedTab(screen === "strong-swing" ? "strong-swing" : "trade-ledger");
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "background") backgroundedAt.current = Date.now();
      if (state === "active" && user && backgroundedAt.current && Date.now() - backgroundedAt.current > 60_000) {
        setUnlocked(false);
        void unlock();
      }
    });
    return () => { response.remove(); appState.remove(); };
  }, [unlock, user]);
  if (booting) return <Centered><ActivityIndicator color="#34d399" /></Centered>;
  if (bootError) return <Centered><Text style={styles.title}>Offline</Text><Text style={[styles.muted, styles.centerText]}>{bootError}</Text><Action label="Retry" onPress={retry} /></Centered>;
  if (user && !unlocked) return <Centered><Text style={styles.title}>InvestoGenie locked</Text><Action label="Unlock" onPress={() => void unlock()} /></Centered>;
  return <SafeAreaProvider><SafeAreaView style={styles.safe} edges={["top", "right", "bottom", "left"]}><StatusBar style="light" />{
    user ? <Terminal user={user} requestedTab={requestedTab} onRequestedTabHandled={() => setRequestedTab(null)} onLogout={() => logout().then(() => setUser(null))} /> : <Login onLogin={(next) => { setUser(next); setUnlocked(true); }} />
  }</SafeAreaView></SafeAreaProvider>;
}

function Login({ onLogin }: { onLogin: (user: MobileUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const configurationError = apiConfigurationError();
  const submit = async () => {
    setBusy(true); setError("");
    try { onLogin(await login(email.trim(), password)); }
    catch (cause) { setError(message(cause, "Sign in failed")); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.login} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>Investo<Text style={styles.accent}>Genie</Text></Text>
    <Text style={styles.eyebrow}>MOBILE TERMINAL</Text><Text style={styles.title}>Sign in</Text>
    <Text style={styles.muted}>Use the same account as the InvestoGenie web terminal.</Text>
    {!!configurationError && <Text style={styles.error}>{configurationError}</Text>}
    <Field value={email} onChangeText={setEmail} placeholder="Email" keyboard="email-address" autofill="username" />
    <Field value={password} onChangeText={setPassword} placeholder="Password" secure autofill="password" />
    {!!error && <Text style={styles.error}>{error}</Text>}
    <Action label="Open terminal" busy={busy} disabled={!!configurationError} onPress={submit} />
  </ScrollView>;
}

function Terminal({ user, requestedTab, onRequestedTabHandled, onLogout }: { user: MobileUser; requestedTab: Tab | null; onRequestedTabHandled: () => void; onLogout: () => void }) {
  const [market, setMarket] = useState<Market>("IN");
  const [tab, setTab] = useState<Tab>("strong-swing");
  const [screens, setScreens] = useState(MOBILE_FEATURES);
  useEffect(() => { void getScreenCatalog().then((result) => { const supported = supportedMobileFeatures(result.screens); if (supported.length) setScreens(supported); }).catch(() => undefined); }, []);
  const [notificationStatus, setNotificationStatus] = useState("");
  useEffect(() => { void registerDeviceNotifications().then(setNotificationStatus).catch(() => setNotificationStatus("Push registration is temporarily unavailable.")); }, []);
  const requested = requestedTab ?? tab;
  const active = screens.find((screen) => screen.key === requested) ?? screens[0];
  const selectTab = (next: Tab) => { setTab(next); onRequestedTabHandled(); };
  return <View style={styles.flex}>
    <View style={styles.header}><View><Text style={styles.brandSmall}>Investo<Text style={styles.accent}>Genie</Text></Text><Text style={styles.user}>{user.email}</Text></View><Pressable onPress={onLogout}><Text style={styles.link}>Sign out</Text></Pressable></View>
    <View style={styles.switchRow}>{(["IN", "US"] as Market[]).map((value) => <Pressable key={value} onPress={() => setMarket(value)} style={[styles.switch, market === value && styles.switchActive]}><Text style={market === value ? styles.switchTextActive : styles.switchText}>{value === "IN" ? "India" : "US"}</Text></Pressable>)}</View>
    <View style={styles.tabs}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>{screens.map((screen) => <TabButton key={screen.key} active={active.key === screen.key} label={screen.tabLabel} onPress={() => selectTab(screen.key)} />)}</ScrollView></View>
    {!!notificationStatus && <Text style={styles.deviceStatus}>{notificationStatus}</Text>}
    <View style={styles.flex}>{active.kind === "native" && NATIVE_SCREENS[active.key] ? <Fragment key={`${active.key}:${market}`}>{NATIVE_SCREENS[active.key]({ market })}</Fragment> : <Suspense key={`${active.key}:${market}`} fallback={<Centered><ActivityIndicator color="#34d399" /></Centered>}><LazyServerCardScreen screenKey={active.key} title={active.title} market={market} /></Suspense>}</View>
  </View>;
}

function Field({ value, onChangeText, placeholder, keyboard, secure, autofill }: { value: string; onChangeText: (value: string) => void; placeholder: string; keyboard?: "email-address" | "decimal-pad"; secure?: boolean; autofill?: "username" | "password" }) { return <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#697078" autoCapitalize="none" autoCorrect={false} keyboardType={keyboard} secureTextEntry={secure} textContentType={autofill} autoComplete={autofill === "password" ? "current-password" : autofill} />; }
function Action({ label, onPress, busy = false, disabled = false }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) { return <Pressable style={[styles.primary, disabled && styles.disabled]} onPress={onPress} disabled={busy || disabled}>{busy ? <ActivityIndicator color="#04110d" /> : <Text style={styles.primaryText}>{label}</Text>}</Pressable>; }
const Centered = ({ children }: { children: React.ReactNode }) => <View style={styles.center}>{children}</View>;
const TabButton = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}><Text style={active ? styles.tabTextActive : styles.tabText}>{label}</Text></Pressable>;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#05070a" }, flex: { flex: 1 }, centerText: { textAlign: "center", paddingHorizontal: 28 }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#05070a" },
  login: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 14, backgroundColor: "#05070a" }, brand: { color: "#f7f8fa", fontSize: 30, fontWeight: "900" }, brandSmall: { color: "#f7f8fa", fontSize: 20, fontWeight: "900" }, accent: { color: "#34d399" }, eyebrow: { color: "#34d399", fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  title: { color: "#f7f8fa", fontSize: 27, fontWeight: "900" }, muted: { color: "#858c95", fontSize: 14, lineHeight: 21 }, input: { color: "#f7f8fa", backgroundColor: "#0c1015", borderColor: "#242a32", borderWidth: 1, borderRadius: 8, paddingHorizontal: 15, height: 52 },
  error: { color: "#fb7185" }, success: { color: "#6ee7b7", marginTop: 12 }, warning: { color: "#fbbf24", borderColor: "#6b4d0d", borderWidth: 1, padding: 12, borderRadius: 7 }, primary: { backgroundColor: "#34d399", borderRadius: 8, minHeight: 52, alignItems: "center", justifyContent: "center", marginVertical: 4 }, disabled: { opacity: 0.45 }, primaryText: { color: "#04110d", fontSize: 15, fontWeight: "900" },
  header: { paddingHorizontal: 18, paddingVertical: 12, borderBottomColor: "#1d2229", borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, user: { color: "#707780", fontSize: 10, marginTop: 2 }, link: { color: "#5eead4", fontWeight: "700" },
  switchRow: { flexDirection: "row", padding: 12, gap: 8 }, switch: { flex: 1, alignItems: "center", padding: 10, borderWidth: 1, borderColor: "#252b33", borderRadius: 7 }, switchActive: { backgroundColor: "#102a22", borderColor: "#2b8c70" }, switchText: { color: "#777f89", fontWeight: "800" }, switchTextActive: { color: "#6ee7b7", fontWeight: "900" },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#20252c", backgroundColor: "#080b0f", paddingHorizontal: 12, paddingBottom: 8, gap: 8 }, tabScroll: { gap: 6 }, tab: { alignItems: "center", paddingVertical: 11, paddingHorizontal: 14, borderRadius: 7 }, tabActive: { backgroundColor: "#123126" }, tabText: { color: "#727983", fontSize: 12, fontWeight: "800" }, tabTextActive: { color: "#6ee7b7", fontSize: 12, fontWeight: "900" },
  deviceStatus: { color: "#6f7781", fontSize: 9, paddingHorizontal: 16, paddingBottom: 4 },
});
