import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import {
  apiConfigurationError, login, logout, restoreSession, type Market, type MobileUser,
} from "./src/api";
import { AppShell } from "./src/app/AppShell";
import { resolveDeepLink, type DeepLinkTarget } from "./src/app/navigation";
import { unlockWithBiometrics } from "./src/deviceSecurity";
import { colors, radius } from "./src/design/tokens";
import { errorMessage } from "./src/format";
import { Action } from "./src/ui";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [user, setUser] = useState<MobileUser | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [market, setMarket] = useState<Market>("IN");
  const [deepLink, setDeepLink] = useState<DeepLinkTarget | null>(null);
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
      setBootError(errorMessage(cause, "InvestoGenie could not be reached."));
    }).finally(() => setBooting(false));
  }, []);

  useEffect(() => { boot(); }, [boot]);
  const retry = () => { setBooting(true); setBootError(""); boot(); };

  useEffect(() => {
    const response = Notifications.addNotificationResponseReceivedListener((notificationResponse) => {
      const data = notificationResponse.notification.request.content.data as Record<string, unknown> | undefined;
      // Opening from a notification must still pass the biometric lock.
      const target = resolveDeepLink(data);
      if (target.market) setMarket(target.market);
      setDeepLink(target);
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

  if (booting) return <Centered><ActivityIndicator color={colors.emerald} /></Centered>;
  if (bootError) return <Centered><Text style={styles.title}>Offline</Text><Text style={[styles.muted, styles.centerText]}>{bootError}</Text><Action label="Retry" onPress={retry} /></Centered>;
  if (user && !unlocked) return <Centered><Text style={styles.title}>InvestoGenie locked</Text><Action label="Unlock" onPress={() => void unlock()} /></Centered>;
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={["top", "right", "bottom", "left"]}>
        <StatusBar style="light" />
        {user ? (
          <AppShell
            user={user}
            market={market}
            onMarketChange={setMarket}
            deepLink={deepLink}
            onDeepLinkHandled={() => setDeepLink(null)}
            onLogout={() => logout().then(() => {
              setUser(null);
              setMarket("IN");
              setDeepLink(null);
            })}
          />
        ) : (
          <Login onLogin={(next) => { setUser(next); setUnlocked(true); }} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
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
    catch (cause) { setError(errorMessage(cause, "Sign in failed")); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={styles.login} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>Investo<Text style={styles.accent}>Genie</Text></Text>
      <Text style={styles.eyebrow}>MOBILE TERMINAL</Text>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.muted}>Use the same account as the InvestoGenie web terminal.</Text>
      {!!configurationError && <Text style={styles.error}>{configurationError}</Text>}
      <Field value={email} onChangeText={setEmail} placeholder="Email" keyboard="email-address" autofill="username" />
      <Field value={password} onChangeText={setPassword} placeholder="Password" secure autofill="password" />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Action label="Open terminal" busy={busy} disabled={!!configurationError} onPress={submit} />
    </ScrollView>
  );
}

function Field({ value, onChangeText, placeholder, keyboard, secure, autofill }: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboard?: "email-address" | "decimal-pad";
  secure?: boolean;
  autofill?: "username" | "password";
}) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textSubtle}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={keyboard}
      secureTextEntry={secure}
      textContentType={autofill}
      autoComplete={autofill === "password" ? "current-password" : autofill}
    />
  );
}

const Centered = ({ children }: { children: React.ReactNode }) => <View style={styles.center}>{children}</View>;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centerText: { textAlign: "center", paddingHorizontal: 28 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  login: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 14, backgroundColor: colors.bg },
  brand: { color: colors.text, fontSize: 30, fontWeight: "900" },
  accent: { color: colors.emerald },
  eyebrow: { color: colors.emerald, fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  title: { color: colors.text, fontSize: 27, fontWeight: "900" },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 15,
    height: 52,
  },
  error: { color: colors.rose },
});
