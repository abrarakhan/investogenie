"use client";

import { useMemo, useState } from "react";
import { updateCredentials, clearCredential, type NewsProvider, type StoredCredentials } from "@/lib/credentials-actions";
import { AI_PROVIDERS, DEFAULT_MODEL_BY_PROVIDER, type AIProvider } from "@/lib/ai/providers";

interface Props {
  initialCreds: StoredCredentials | null;
  breezeStatus?: string;
  breezeCallbackUrl: string;
}

const BREEZE_STATUS: Record<string, { type: "success" | "error"; text: string }> = {
  connected: { type: "success", text: "Today’s Breeze session was saved. The live worker will reconnect within 30 seconds." },
  denied: { type: "error", text: "ICICI Direct did not return a Breeze API session. Sign in again and complete every confirmation step." },
  invalid_state: { type: "error", text: "The Breeze login link expired or returned in a different browser. Start again here and finish within 10 minutes." },
  not_configured: { type: "error", text: "Save the Breeze API key and secret before generating a daily session." },
  failed: { type: "error", text: "The returned Breeze session could not be saved. Please try again." },
};

const CUSTOM = "__custom__";
const NEWS_PROVIDERS: Array<{ key: NewsProvider; label: string; hint: string }> = [
  { key: "alpha_vantage", label: "Alpha Vantage News Sentiment", hint: "Finance-native sentiment and ticker relevance. Best first choice for US coverage." },
  { key: "gnews", label: "GNews", hint: "Broad India and US business-news search with country filtering." },
  { key: "newsapi", label: "NewsAPI", hint: "Broad publisher coverage and advanced keyword search." },
];

function formatIstTimestamp(value: string | Date | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export default function CredentialsForm({ initialCreds, breezeStatus, breezeCallbackUrl }: Props) {
  // --- SMTP state ---
  const [smtpHost, setSmtpHost] = useState(initialCreds?.smtpHost || "");
  const [smtpPort, setSmtpPort] = useState(initialCreds?.smtpPort || 587);
  const [smtpUser, setSmtpUser] = useState(initialCreds?.smtpUser || "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpPasswordSet, setSmtpPasswordSet] = useState(!!initialCreds?.smtpPasswordSet);

  // --- AI provider state ---
  const initialProvider: AIProvider = initialCreds?.aiProvider ?? "deepseek";
  const [provider, setProvider] = useState<AIProvider>(initialProvider);

  const providerMeta = useMemo(
    () => AI_PROVIDERS.find((p) => p.key === provider) ?? AI_PROVIDERS[0],
    [provider],
  );

  // Is the stored model one of the presets, or a custom value?
  const storedModel = initialCreds?.aiModel ?? "";
  const storedIsPreset = providerMeta.models.includes(storedModel);
  const [modelChoice, setModelChoice] = useState<string>(
    storedModel ? (storedIsPreset ? storedModel : CUSTOM) : DEFAULT_MODEL_BY_PROVIDER[initialProvider],
  );
  const [customModel, setCustomModel] = useState<string>(storedIsPreset ? "" : storedModel);
  const [aiKey, setAiKey] = useState("");
  const [aiKeySet, setAiKeySet] = useState(!!initialCreds?.aiApiKeySet);
  const [newsProvider, setNewsProvider] = useState<NewsProvider>(initialCreds?.newsProvider ?? "gnews");
  const [newsKey, setNewsKey] = useState("");
  const [newsKeySet, setNewsKeySet] = useState(!!initialCreds?.newsApiKeySet);
  const [breezeApiKey, setBreezeApiKey] = useState("");
  const [breezeApiSecret, setBreezeApiSecret] = useState("");
  const [breezeSessionToken, setBreezeSessionToken] = useState("");
  const [breezeApiKeySet, setBreezeApiKeySet] = useState(!!initialCreds?.breezeApiKeySet);
  const [breezeApiSecretSet, setBreezeApiSecretSet] = useState(!!initialCreds?.breezeApiSecretSet);
  const [breezeSessionTokenSet, setBreezeSessionTokenSet] = useState(!!initialCreds?.breezeSessionTokenSet);
  const [breezeSessionUpdatedAt, setBreezeSessionUpdatedAt] = useState<string | null>(
    initialCreds?.breezeSessionUpdatedAt
      ? new Date(initialCreds.breezeSessionUpdatedAt).toISOString()
      : null,
  );

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const effectiveModel = modelChoice === CUSTOM ? customModel.trim() : modelChoice;

  const onProviderChange = (next: AIProvider) => {
    setProvider(next);
    // Reset the model selection to that provider's default preset.
    setModelChoice(DEFAULT_MODEL_BY_PROVIDER[next]);
    setCustomModel("");
  };

  const handleSaveSmtp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await updateCredentials({ smtpHost, smtpPort, smtpUser, smtpPassword: smtpPassword || undefined });
      setSmtpPassword("");
      if (smtpPassword) setSmtpPasswordSet(true);
      setMessage({ type: "success", text: "SMTP credentials saved securely." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save SMTP" });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAi = async () => {
    if (!effectiveModel) {
      setMessage({ type: "error", text: "Enter a model name." });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await updateCredentials({
        aiProvider: provider,
        aiModel: effectiveModel,
        aiApiKey: aiKey || undefined,
      });
      setAiKey("");
      if (aiKey) setAiKeySet(true);
      setMessage({
        type: "success",
        text: `Saved: ${providerMeta.label} · ${effectiveModel}${aiKey ? " (key updated)" : ""}.`,
      });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save AI settings" });
    } finally {
      setLoading(false);
    }
  };

  const handleClearSmtpPassword = async () => {
    setLoading(true);
    try {
      await clearCredential("smtpPassword");
      setSmtpPasswordSet(false);
      setMessage({ type: "success", text: "SMTP password cleared." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to clear" });
    } finally {
      setLoading(false);
    }
  };

  const handleClearAiKey = async () => {
    setLoading(true);
    try {
      await clearCredential("aiApiKey");
      setAiKeySet(false);
      setMessage({ type: "success", text: "AI API key cleared." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to clear" });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNews = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await updateCredentials({ newsProvider, newsApiKey: newsKey || undefined });
      setNewsKey("");
      if (newsKey) setNewsKeySet(true);
      setMessage({ type: "success", text: `News provider saved: ${NEWS_PROVIDERS.find((item) => item.key === newsProvider)?.label}.` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save news API" });
    } finally {
      setLoading(false);
    }
  };

  const handleClearNewsKey = async () => {
    setLoading(true);
    try {
      await clearCredential("newsApiKey");
      setNewsKeySet(false);
      setMessage({ type: "success", text: "News API key cleared." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to clear news key" });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBreeze = async () => {
    if (!breezeApiKeySet && !breezeApiKey.trim()) {
      setMessage({ type: "error", text: "Enter the Breeze API key for first-time setup." });
      return;
    }
    if (!breezeApiSecretSet && !breezeApiSecret.trim()) {
      setMessage({ type: "error", text: "Enter the Breeze API secret for first-time setup." });
      return;
    }
    if (!breezeSessionToken.trim()) {
      setMessage({ type: "error", text: "Enter today's Breeze session token." });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const updated = await updateCredentials({
        breezeApiKey: breezeApiKey || undefined,
        breezeApiSecret: breezeApiSecret || undefined,
        breezeSessionToken,
      });
      if (breezeApiKey) setBreezeApiKeySet(true);
      if (breezeApiSecret) setBreezeApiSecretSet(true);
      setBreezeSessionTokenSet(true);
      setBreezeSessionUpdatedAt(
        updated.breezeSessionUpdatedAt
          ? new Date(updated.breezeSessionUpdatedAt).toISOString()
          : null,
      );
      setBreezeApiKey("");
      setBreezeApiSecret("");
      setBreezeSessionToken("");
      setMessage({ type: "success", text: "Breeze credentials saved. The live worker will connect or reconnect within 30 seconds." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save Breeze credentials" });
    } finally {
      setLoading(false);
    }
  };

  const handleClearBreeze = async () => {
    setLoading(true);
    try {
      await clearCredential("breeze");
      setBreezeApiKeySet(false);
      setBreezeApiSecretSet(false);
      setBreezeSessionTokenSet(false);
      setBreezeSessionUpdatedAt(null);
      setMessage({ type: "success", text: "Breeze credentials cleared." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to clear Breeze credentials" });
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[var(--ig-primary)]";

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="mb-1 text-lg font-semibold">ICICI Breeze market data</h3>
        <p className="mb-4 text-sm text-white/50">
          Optional primary live feed for priority NSE/BSE stocks. Yahoo and Google remain active as the 15-minute fallback, and Bhavcopy remains the end-of-day authority. Generate a fresh Breeze session token before each trading day.
        </p>
        {breezeStatus && BREEZE_STATUS[breezeStatus] && (
          <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${BREEZE_STATUS[breezeStatus].type === "success" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-rose-400/25 bg-rose-400/10 text-rose-200"}`}>
            {BREEZE_STATUS[breezeStatus].text}
          </p>
        )}
        <div className="space-y-4">
          <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-3 text-xs leading-relaxed text-white/55">
            In the ICICI Breeze app registration, set the Redirect URI exactly to
            <code className="mt-1 block break-all font-mono text-cyan-200">{breezeCallbackUrl}</code>
            Then use the button below on the same mobile browser where InvestoGenie is signed in. Your ICICI password and OTP never pass through InvestoGenie.
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-white/80">API key</span>
              <input type="password" value={breezeApiKey} onChange={(event) => setBreezeApiKey(event.target.value)} placeholder={breezeApiKeySet ? "Saved; leave blank to keep" : "Breeze API key"} disabled={loading} className={inputCls} autoComplete="off" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-white/80">API secret</span>
              <input type="password" value={breezeApiSecret} onChange={(event) => setBreezeApiSecret(event.target.value)} placeholder={breezeApiSecretSet ? "Saved; leave blank to keep" : "Breeze API secret"} disabled={loading} className={inputCls} autoComplete="new-password" />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-white/80">Today&apos;s session token</span>
            <input type="password" value={breezeSessionToken} onChange={(event) => setBreezeSessionToken(event.target.value)} placeholder={breezeSessionTokenSet ? "Paste a new daily token" : "Daily Breeze session token"} disabled={loading} className={inputCls} autoComplete="off" />
            <span className="mt-1 block text-xs text-white/40">
              {formatIstTimestamp(breezeSessionUpdatedAt) ? `Last replaced ${formatIstTimestamp(breezeSessionUpdatedAt)} IST. ` : ""}
              The API key and secret are needed only once; replace the session token daily.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            {breezeApiKeySet && breezeApiSecretSet && (
              <a href="/api/breeze/connect" className="inline-flex min-h-10 items-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/15">
                Generate today&apos;s session on ICICI Direct
              </a>
            )}
            <button onClick={handleSaveBreeze} disabled={loading} className="rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
              {loading ? "Saving..." : "Save and reconnect Breeze"}
            </button>
            {(breezeApiKeySet || breezeApiSecretSet || breezeSessionTokenSet) && <button onClick={handleClearBreeze} disabled={loading} className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/10 disabled:opacity-50">Clear Breeze credentials</button>}
          </div>
        </div>
      </div>

      {/* AI Provider */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="mb-1 text-lg font-semibold">🤖 AI model</h3>
        <p className="mb-4 text-sm text-white/50">
          Choose the provider and model that powers News &amp; AI Swing assessments and natural-language screener queries.
          The API key is encrypted (AES-256-GCM) before it is stored.
        </p>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Provider dropdown */}
            <label className="block">
              <span className="text-sm font-medium text-white/80">Provider</span>
              <select
                value={provider}
                onChange={(e) => onProviderChange(e.target.value as AIProvider)}
                disabled={loading}
                className={inputCls}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Model dropdown (+ custom) */}
            <label className="block">
              <span className="text-sm font-medium text-white/80">Model</span>
              <select
                value={modelChoice}
                onChange={(e) => setModelChoice(e.target.value)}
                disabled={loading}
                className={inputCls}
              >
                {providerMeta.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={CUSTOM}>Custom…</option>
              </select>
            </label>
          </div>

          {modelChoice === CUSTOM && (
            <label className="block">
              <span className="text-sm font-medium text-white/80">Custom model ID</span>
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="exact model identifier, e.g. gpt-4.1-2025-04-14"
                disabled={loading}
                className={inputCls}
              />
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-white/80">API key</span>
            <input
              type="password"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder={aiKeySet ? "•••••••••••• (saved)" : "Paste your API key"}
              disabled={loading}
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-white/40">
              {aiKeySet ? "A key is saved. Leave blank to keep it; type a new one to replace it. " : ""}
              {providerMeta.keyHint}
            </span>
          </label>

          <div className="flex gap-2">
            <button
              onClick={handleSaveAi}
              disabled={loading}
              className="rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save AI model"}
            </button>
            {aiKeySet && (
              <button
                onClick={handleClearAiKey}
                disabled={loading}
                className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
              >
                Clear key
              </button>
            )}
          </div>
        </div>
      </div>

      {/* News provider */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="mb-1 text-lg font-semibold">Financial news</h3>
        <p className="mb-4 text-sm text-white/50">
          Supplies source-linked market, macro, and company headlines to News &amp; AI Swing and open Trade Ledger positions. On a personal installation, the encrypted owner key also powers unattended hourly refreshes during each market&apos;s trading hours; deployment environment keys take priority.
        </p>
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-white/80">Provider</span>
            <select value={newsProvider} onChange={(event) => setNewsProvider(event.target.value as NewsProvider)} disabled={loading} className={inputCls}>
              {NEWS_PROVIDERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-white/40">{NEWS_PROVIDERS.find((item) => item.key === newsProvider)?.hint}</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-white/80">News API key</span>
            <input type="password" value={newsKey} onChange={(event) => setNewsKey(event.target.value)} placeholder={newsKeySet ? "•••••••••••• (saved)" : "Paste provider API key"} disabled={loading} className={inputCls} />
            <span className="mt-1 block text-xs text-white/40">{newsKeySet ? "A key is saved. Leave blank to keep it." : "Required for live headline ingestion."}</span>
          </label>
          <div className="flex gap-2">
            <button onClick={handleSaveNews} disabled={loading} className="rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
              {loading ? "Saving..." : "Save news API"}
            </button>
            {newsKeySet && <button onClick={handleClearNewsKey} disabled={loading} className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/10 disabled:opacity-50">Clear key</button>}
          </div>
        </div>
      </div>

      {/* SMTP */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="mb-1 text-lg font-semibold">📧 Email (SMTP)</h3>
        <p className="mb-4 text-sm text-white/50">
          Used to deliver the daily email digest. The password is encrypted before storage.
        </p>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-white/80">SMTP Host</span>
              <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" disabled={loading} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-white/80">SMTP Port</span>
              <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(parseInt(e.target.value))} placeholder="587" disabled={loading} className={inputCls} />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-white/80">SMTP Username (email)</span>
            <input type="email" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="you@gmail.com" disabled={loading} className={inputCls} />
            <span className="mt-1 block text-xs text-white/40">For Gmail, use an app password.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-white/80">SMTP Password</span>
            <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder={smtpPasswordSet ? "•••••••••••• (saved)" : "Enter password"} disabled={loading} className={inputCls} />
            <span className="mt-1 block text-xs text-white/40">
              {smtpPasswordSet ? "A password is saved. Leave blank to keep it." : "Leave blank to skip."}
            </span>
          </label>

          <div className="flex gap-2">
            <button onClick={handleSaveSmtp} disabled={loading} className="rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
              {loading ? "Saving…" : "Save SMTP"}
            </button>
            {smtpPasswordSet && (
              <button onClick={handleClearSmtpPassword} disabled={loading} className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/10 disabled:opacity-50">
                Clear password
              </button>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border border-rose-500/30 bg-rose-500/10 text-rose-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400">
        <strong>🔒 Security:</strong> All keys and passwords are encrypted with AES-256-GCM
        before storage and decrypted only on the server when needed. The encryption key lives
        in the <code>CREDENTIAL_ENCRYPTION_KEY</code> env var and is never stored in the database.
      </div>
    </div>
  );
}
