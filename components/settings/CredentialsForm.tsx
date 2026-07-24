"use client";

import { useMemo, useState } from "react";
import { updateCredentials, clearCredential, type StoredCredentials } from "@/lib/credentials-actions";
import { AI_PROVIDERS, DEFAULT_MODEL_BY_PROVIDER, type AIProvider } from "@/lib/ai/providers";

interface Props {
  initialCreds: StoredCredentials | null;
}

const CUSTOM = "__custom__";

export default function CredentialsForm({ initialCreds }: Props) {
  // --- SMTP state ---
  const [smtpHost, setSmtpHost] = useState(initialCreds?.smtpHost || "");
  const [smtpPort, setSmtpPort] = useState(initialCreds?.smtpPort || 587);
  const [smtpUser, setSmtpUser] = useState(initialCreds?.smtpUser || "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpPasswordSet, setSmtpPasswordSet] = useState(!!initialCreds?.smtpPasswordSet);

  // --- AI provider state ---
  const initialProvider: AIProvider = initialCreds?.aiProvider ?? "anthropic";
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

  const inputCls =
    "mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[var(--ig-primary)]";

  return (
    <div className="space-y-8">
      {/* AI Provider */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="mb-1 text-lg font-semibold">🤖 AI model</h3>
        <p className="mb-4 text-sm text-white/50">
          Choose the provider and model that powers natural-language screener queries.
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
