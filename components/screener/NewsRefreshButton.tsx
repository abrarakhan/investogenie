"use client";

import { useActionState } from "react";
import { refreshNewsSwing, type RefreshNewsState } from "@/app/terminal/[market]/news-swing/actions";
import type { MarketId } from "@/lib/types";

const INITIAL: RefreshNewsState = { ok: false, message: "" };

export default function NewsRefreshButton({ market, configured }: { market: MarketId; configured: boolean }) {
  const [state, action, pending] = useActionState(refreshNewsSwing, INITIAL);
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <form action={action}>
        <input type="hidden" name="market" value={market} />
        <button
          type="submit"
          disabled={!configured || pending}
          className="min-h-10 rounded-lg border border-[var(--ig-accent)]/35 bg-[var(--ig-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--ig-accent)] transition-colors hover:bg-[var(--ig-accent)]/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Fetching and analyzing..." : "Refresh news intelligence"}
        </button>
      </form>
      {state.message && (
        <p role="status" className={`max-w-sm text-xs ${state.ok ? "text-emerald-300" : "text-rose-300"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}
