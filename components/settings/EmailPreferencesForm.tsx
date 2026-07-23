"use client";

import { useState } from "react";
import { updateEmailPreferences, type EmailPreferences } from "@/lib/email-actions";

interface Props {
  initialPrefs: EmailPreferences | null;
  userEmail: string;
}

export default function EmailPreferencesForm({ initialPrefs, userEmail }: Props) {
  const [prefs, setPrefs] = useState<EmailPreferences | null>(initialPrefs);
  const [enabled, setEnabled] = useState(initialPrefs?.enabled ?? false);
  const [sendTime, setSendTime] = useState(initialPrefs?.sendTime ?? "07:00");
  const [includeSwing, setIncludeSwing] = useState(initialPrefs?.includeSwingCandidates ?? true);
  const [includeProb, setIncludeProb] = useState(initialPrefs?.includeProbability ?? true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const updated = await updateEmailPreferences({
        enabled,
        sendTime,
        includeSwingCandidates: includeSwing,
        includeProbability: includeProb,
      });
      setPrefs(updated);
      setMessage({
        type: "success",
        text: enabled ? "Email digest enabled. You'll receive it at 7 AM IST daily." : "Email digest disabled.",
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update preferences",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={loading}
            className="mt-1 h-4 w-4"
          />
          <div>
            <span className="block text-sm font-medium">Enable daily email digest</span>
            <span className="block text-xs text-white/40">
              Receive top 5 stocks from swing candidates and probability screens every morning
            </span>
          </div>
        </label>
      </div>

      {enabled && (
        <>
          <div>
            <label className="block">
              <span className="text-sm font-medium text-white/80">Recipient email</span>
              <input
                type="email"
                disabled
                value={userEmail}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/50 outline-none"
              />
              <span className="mt-1 block text-xs text-white/40">Email digest will be sent to your account email</span>
            </label>
          </div>

          <div>
            <label className="block">
              <span className="text-sm font-medium text-white/80">Send time</span>
              <select
                value={sendTime}
                onChange={(e) => setSendTime(e.target.value)}
                disabled={loading}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[var(--ig-primary)]"
              >
                <option value="07:00">7:00 AM IST (before market opens)</option>
                <option value="08:00">8:00 AM IST</option>
                <option value="09:00">9:00 AM IST</option>
              </select>
              <span className="mt-1 block text-xs text-white/40">Scheduled time for the daily email</span>
            </label>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-white/80">Include in digest</p>

            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <input
                type="checkbox"
                checked={includeSwing}
                onChange={(e) => setIncludeSwing(e.target.checked)}
                disabled={loading}
                className="mt-1 h-4 w-4"
              />
              <div>
                <span className="block text-sm">🎯 Swing candidates</span>
                <span className="block text-xs text-white/40">Top 5 swing trading setups</span>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <input
                type="checkbox"
                checked={includeProb}
                onChange={(e) => setIncludeProb(e.target.checked)}
                disabled={loading}
                className="mt-1 h-4 w-4"
              />
              <div>
                <span className="block text-sm">📊 Probability screen</span>
                <span className="block text-xs text-white/40">Top 5 probability-based picks</span>
              </div>
            </label>
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={loading}
          className="rounded-lg bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)] px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
        >
          {loading ? "Saving…" : "Save preferences"}
        </button>
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

      {prefs?.lastSentAt && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-white/50">
          Last sent: {new Date(prefs.lastSentAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
        </div>
      )}
    </div>
  );
}
