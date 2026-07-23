"use client";

import { useState } from "react";
import { parseScreenIntent } from "@/lib/screener-actions";
// Type-only — erased at build time, so the Anthropic SDK never reaches the
// client bundle.
import type { ScreenIntent } from "@/lib/screener/nlQuery";

interface Props {
  market: string;
  isAuthed: boolean;
  onApply: (intent: ScreenIntent) => void;
}

const PLACEHOLDER: Record<string, string> = {
  IN: "e.g. profitable smallcaps under 30 P/E with ROE above 15",
  US: "e.g. large caps over $50 billion near their 52-week high",
};

export default function NlQueryBar({ market, isAuthed, onApply }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  if (!isAuthed) return null;

  const submit = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setNotes(null);
    try {
      const intent = await parseScreenIntent({ query, market });
      onApply(intent);
      setNotes(intent.notes || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not interpret that query");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          disabled={loading}
          maxLength={500}
          placeholder={PLACEHOLDER[market] ?? PLACEHOLDER.IN}
          aria-label="Describe a screen in plain English"
          className="min-w-0 flex-1 rounded-lg border border-[var(--ig-accent,#22d3ee)]/30 bg-[#0a0e17] px-3 py-2 text-sm text-white/85 placeholder:text-white/25 focus:border-[var(--ig-accent,#22d3ee)]/60 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={loading || !query.trim()}
          className="shrink-0 rounded-lg border border-[var(--ig-accent,#22d3ee)]/40 px-3 py-2 text-sm text-white/80 hover:bg-[var(--ig-accent,#22d3ee)]/10 disabled:opacity-30"
        >
          {loading ? "Reading…" : "Build screen"}
        </button>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
      {notes && <p className="text-xs text-amber-300/80">{notes}</p>}
      {!error && !notes && (
        <p className="text-xs text-white/30">
          Generated filters appear as chips below — edit or remove any of them.
        </p>
      )}
    </div>
  );
}
