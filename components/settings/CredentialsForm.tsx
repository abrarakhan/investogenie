"use client";

import { useState } from "react";
import { updateCredentials, clearCredential, type StoredCredentials } from "@/lib/credentials-actions";

interface Props {
  initialCreds: StoredCredentials | null;
}

export default function CredentialsForm({ initialCreds }: Props) {
  const [smtpHost, setSmtpHost] = useState(initialCreds?.smtpHost || "");
  const [smtpPort, setSmtpPort] = useState(initialCreds?.smtpPort || 587);
  const [smtpUser, setSmtpUser] = useState(initialCreds?.smtpUser || "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpPasswordSet, setSmtpPasswordSet] = useState(!!initialCreds?.anthropicApiKey);

  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicKeySet, setAnthropicKeySet] = useState(!!initialCreds?.anthropicApiKey);

  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiKeySet, setOpenaiKeySet] = useState(!!initialCreds?.openaiApiKey);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSaveSmtp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await updateCredentials({
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPassword: smtpPassword || undefined,
      });
      setSmtpPassword("");
      setSmtpPasswordSet(!!smtpPassword);
      setMessage({ type: "success", text: "SMTP credentials saved securely." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save credentials",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAI = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await updateCredentials({
        anthropicApiKey: anthropicKey || undefined,
        openaiApiKey: openaiKey || undefined,
      });
      setAnthropicKey("");
      setOpenaiKey("");
      setAnthropicKeySet(!!anthropicKey);
      setOpenaiKeySet(!!openaiKey);
      setMessage({ type: "success", text: "API keys saved securely." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save API keys",
      });
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
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to clear password",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClearApiKey = async (provider: "anthropic" | "openai") => {
    setLoading(true);
    try {
      await clearCredential(provider === "anthropic" ? "anthropicApiKey" : "openaiApiKey");
      if (provider === "anthropic") setAnthropicKeySet(false);
      else setOpenaiKeySet(false);
      setMessage({ type: "success", text: `${provider} key cleared.` });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to clear key",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* SMTP Configuration */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="mb-4 text-lg font-semibold">📧 Email (SMTP)</h3>
        <p className="mb-4 text-sm text-white/50">
          Configure SMTP for sending email digests. Credentials are encrypted and stored securely
          in the database.
        </p>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-white/80">SMTP Host</span>
              <input
                type="text"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
                disabled={loading}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--ig-primary)]"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-white/80">SMTP Port</span>
              <input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(parseInt(e.target.value))}
                placeholder="587"
                disabled={loading}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--ig-primary)]"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-white/80">SMTP Username (email address)</span>
            <input
              type="email"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="your-email@gmail.com"
              disabled={loading}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--ig-primary)]"
            />
            <span className="mt-1 block text-xs text-white/40">For Gmail: use app password, not regular password</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-white/80">SMTP Password</span>
            <input
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              placeholder={smtpPasswordSet ? "••••••••••••" : "Enter password"}
              disabled={loading}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--ig-primary)]"
            />
            <span className="mt-1 block text-xs text-white/40">
              {smtpPasswordSet ? "Password is set. Leave blank to keep current." : "Leave blank to skip"}
            </span>
          </label>

          <div className="flex gap-2">
            <button
              onClick={handleSaveSmtp}
              disabled={loading}
              className="rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save SMTP"}
            </button>
            {smtpPasswordSet && (
              <button
                onClick={handleClearSmtpPassword}
                disabled={loading}
                className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
              >
                Clear password
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AI Provider API Keys */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="mb-4 text-lg font-semibold">🤖 AI Providers</h3>
        <p className="mb-4 text-sm text-white/50">
          Store API keys for AI features like natural language screener queries. All keys are
          encrypted with AES-256-GCM.
        </p>

        <div className="space-y-6">
          {/* Anthropic / Claude */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">🔵 Anthropic (Claude)</span>
              <input
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder={anthropicKeySet ? "sk-ant-••••••••••••" : "sk-ant-..."}
                disabled={loading}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--ig-primary)]"
              />
              <span className="mt-1 block text-xs text-white/40">
                {anthropicKeySet ? "Key is set. Leave blank to keep current." : "Get from console.anthropic.com"}
              </span>
            </label>
          </div>

          {/* OpenAI */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">🟢 OpenAI (GPT)</span>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder={openaiKeySet ? "sk-••••••••••••" : "sk-..."}
                disabled={loading}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--ig-primary)]"
              />
              <span className="mt-1 block text-xs text-white/40">
                {openaiKeySet ? "Key is set. Leave blank to keep current." : "Get from platform.openai.com/api-keys"}
              </span>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSaveAI}
              disabled={loading}
              className="rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save API Keys"}
            </button>
            {(anthropicKeySet || openaiKeySet) && (
              <>
                {anthropicKeySet && (
                  <button
                    onClick={() => handleClearApiKey("anthropic")}
                    disabled={loading}
                    className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    Clear Anthropic
                  </button>
                )}
                {openaiKeySet && (
                  <button
                    onClick={() => handleClearApiKey("openai")}
                    disabled={loading}
                    className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    Clear OpenAI
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
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

      {/* Security note */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400">
        <strong>🔒 Security:</strong> All credentials are encrypted with AES-256-GCM before storage
        and decrypted on-demand. The encryption key is stored in the <code>CREDENTIAL_ENCRYPTION_KEY</code> env
        variable and never exposed.
      </div>
    </div>
  );
}
