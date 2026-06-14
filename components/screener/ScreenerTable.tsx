"use client";

import { useMemo, useState } from "react";
import type { ScreenRow } from "@/lib/screener";

const VERDICT_STYLE: Record<string, string> = {
  LONG_BREAKOUT: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  COILED_SPRING: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  BREAKOUT_UNCONFIRMED: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  SHORT_BREAKDOWN: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  SHORT_COILED_SPRING: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  BREAKDOWN_UNCONFIRMED: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  NO_SETUP: "bg-white/5 text-white/40 border-white/10",
};

type MarketFilter = "ALL" | "US" | "IN";
type SetupFilter = "SETUPS" | "ALL";

export default function ScreenerTable({
  rows,
  scoped = false,
}: {
  rows: ScreenRow[];
  scoped?: boolean;
}) {
  const [q, setQ] = useState("");
  const [market, setMarket] = useState<MarketFilter>("ALL");
  const [setup, setSetup] = useState<SetupFilter>("SETUPS");

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return rows.filter((r) => {
      if (market !== "ALL" && r.country !== market) return false;
      if (setup === "SETUPS" && r.verdict === "NO_SETUP") return false;
      if (needle && !r.ticker.includes(needle)) return false;
      return true;
    });
  }, [rows, q, market, setup]);

  const counts = useMemo(() => {
    const c = { total: rows.length, setups: 0, long: 0 };
    for (const r of rows) {
      if (r.verdict !== "NO_SETUP") c.setups++;
      if (r.verdict === "LONG_BREAKOUT") c.long++;
    }
    return c;
  }, [rows]);

  return (
    <div>
      {/* Controls */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ticker…"
          className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-[var(--ig-primary)] sm:max-w-xs"
        />
        <div className="flex gap-2">
          {!scoped &&
            (["ALL", "US", "IN"] as MarketFilter[]).map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                  market === m ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50"
                }`}
              >
                {m === "US" ? "🇺🇸 US" : m === "IN" ? "🇮🇳 India" : "All"}
              </button>
            ))}
          <button
            onClick={() => setSetup(setup === "SETUPS" ? "ALL" : "SETUPS")}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
              setup === "SETUPS" ? "border-[var(--ig-accent)]/40 bg-[var(--ig-accent)]/10 text-[var(--ig-accent)]" : "border-white/10 text-white/50"
            }`}
          >
            {setup === "SETUPS" ? "Setups only" : "Show all"}
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-6 text-xs text-white/50">
        <span>{counts.total} scanned</span>
        <span>{counts.setups} active setups</span>
        <span className="text-emerald-400">{counts.long} long breakouts</span>
        <span className="ml-auto">{filtered.length} shown</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3">Dir</th>
              <th className="px-4 py-3 text-right">Current</th>
              <th className="px-4 py-3 text-right">Entry</th>
              <th className="px-4 py-3 text-right">Target</th>
              <th className="px-4 py-3 text-right">Stop</th>
              <th className="px-4 py-3 text-right">Trail</th>
              <th className="px-4 py-3 text-right">R:R</th>
              <th className="px-4 py-3 text-right">~Days</th>
              <th className="px-4 py-3 text-right">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-white/40">
                  No matches.
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const current = r.lastQuote ?? r.close;
              const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(2));
              return (
                <tr key={`${r.exchange}:${r.ticker}`} className="border-t border-white/5">
                  <td className="px-4 py-3">
                    <span className="font-semibold">{r.ticker}</span>
                    <span className="ml-2 text-[10px] uppercase text-white/30">{r.assetClass}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.direction === "SHORT" ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                      {r.direction === "SHORT" ? "SHORT" : "LONG"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {current.toFixed(2)}
                    {r.quoteChangePct !== null && (
                      <span className={`ml-1 text-[10px] ${r.quoteChangePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {r.quoteChangePct >= 0 ? "+" : ""}{r.quoteChangePct.toFixed(2)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/80">{fmt(r.entry)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-400">{fmt(r.target)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-rose-400">{fmt(r.stopLoss)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-300/80">{fmt(r.trailingStop)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/60">
                    {r.riskReward ? `${r.riskReward.toFixed(1)}×` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/60">
                    {r.expectedDays ? `${r.expectedDays}d` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${VERDICT_STYLE[r.verdict]}`}>
                      {r.verdict.replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
