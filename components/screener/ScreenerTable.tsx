"use client";

import { useMemo, useState } from "react";
import type { ScreenRow, StrategyLevel } from "@/lib/screener";
import { STRATEGY_META, type StrategyKey } from "@/lib/analytics/legendaryStrategies";

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
type StrategyFilter = "ALL" | StrategyKey;

const STRATEGY_LABEL: Record<StrategyKey, string> = Object.fromEntries(
  STRATEGY_META.map((m) => [m.key, m.label]),
) as Record<StrategyKey, string>;

const fmt2 = (n: number | null) => (n === null ? "—" : n.toFixed(2));
const fmtRatio = (n: number | null) => (n === null ? "—" : n.toFixed(1));
const fmtPct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const formatVerdict = (verdict: string) => verdict.replace(/^LONG_/, "BUY_").replaceAll("_", " ");
/** Compact Rs. Crore — rolls up to Lakh-Cr / k-Cr for large caps. */
const fmtCr = (n: number | null): string => {
  if (n === null) return "—";
  if (n >= 100_000) return `${(n / 100_000).toFixed(2)}L Cr`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k Cr`;
  return `${Math.round(n)} Cr`;
};
const fmtMarketCap = (n: number | null, currency: string | null): string => {
  if (currency !== "USD") return fmtCr(n);
  if (n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}T`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
  return `$${Math.round(n)}M`;
};
const varColor = (n: number | null) =>
  n === null ? "text-white/30" : n >= 0 ? "text-emerald-400" : "text-rose-400";

interface EffectiveLevels {
  current: number | null;
  dir: ScreenRow["direction"];
  entry: number | null;
  target: number | null;
  stopLoss: number | null;
  trailingStop: number | null;
  riskReward: number | null;
  expectedDays: number | null;
}

/** Resolve the levels to display for a row: the selected strategy's custom
 *  levels when a strategy filter is active and the row carries that signature,
 *  otherwise the default swing levels. Shared by the table and card views. */
function effectiveLevels(r: ScreenRow, activeStrategy: StrategyKey | null): EffectiveLevels {
  const sl: StrategyLevel | undefined = activeStrategy ? r.strategyLevels[activeStrategy] : undefined;
  return {
    current: r.lastQuote,
    dir: sl ? sl.direction : r.direction,
    entry: sl ? sl.entry : r.entry,
    target: sl ? sl.target : r.target,
    stopLoss: sl ? sl.stopLoss : r.stopLoss,
    trailingStop: sl ? sl.trailingStop : r.trailingStop,
    riskReward: sl ? sl.riskReward : r.riskReward,
    expectedDays: sl ? sl.expectedDays : r.expectedDays,
  };
}

function ActionBadge({ dir }: { dir: ScreenRow["direction"] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${dir === "SHORT" ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"}`}>
      {dir === "SHORT" ? "SHORT" : "BUY"}
    </span>
  );
}

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
  const [strategy, setStrategy] = useState<StrategyFilter>("ALL");
  // Fundamental ratio filters (blank = no constraint).
  const [minRoce, setMinRoce] = useState("");
  const [maxPe, setMaxPe] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const roceMin = minRoce.trim() === "" ? null : Number(minRoce);
    const peMax = maxPe.trim() === "" ? null : Number(maxPe);
    return rows.filter((r) => {
      if (market !== "ALL" && r.country !== market) return false;
      if (strategy !== "ALL" && !r.strategyTags.includes(strategy)) return false;
      if (strategy !== "ALL" && r.strategyLevels[strategy]?.direction === "SHORT") return false;
      // A strategy filter implies "setups" — skip the NO_SETUP gate so a tagged
      // row still shows even if the default classifier flagged nothing.
      if (strategy === "ALL" && setup === "SETUPS" && r.verdict === "NO_SETUP") return false;
      if (needle && !r.ticker.includes(needle)) return false;
      // Fundamental filters: a missing metric cannot satisfy a numeric bound.
      if (roceMin !== null && Number.isFinite(roceMin) && (r.roce === null || r.roce < roceMin)) return false;
      if (peMax !== null && Number.isFinite(peMax) && (r.peRatio === null || r.peRatio > peMax)) return false;
      return true;
    });
  }, [rows, q, market, setup, strategy, minRoce, maxPe]);

  const hasFundamentals = useMemo(() => rows.some((r) => r.roce !== null || r.peRatio !== null), [rows]);

  // When a specific strategy is selected, surface its custom levels (entry line
  // mapped through the user's risk params) instead of the default swing levels.
  const activeStrategy: StrategyKey | null = strategy === "ALL" ? null : strategy;
  const strategyCounts = useMemo(() => {
    const c = new Map<StrategyKey, number>();
    for (const r of rows) for (const t of r.strategyTags) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  }, [rows]);

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
            {setup === "SETUPS" ? "Buy candidates" : "Show all"}
          </button>
        </div>
      </div>

      {/* Legendary-strategy ribbon */}
      <div className="mb-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          onClick={() => setStrategy("ALL")}
          className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
            strategy === "ALL"
              ? "border-[var(--ig-primary)]/50 bg-[var(--ig-primary)]/15 text-white"
              : "border-white/10 text-white/50 hover:text-white"
          }`}
        >
          All systems
        </button>
        {STRATEGY_META.map((m) => {
          const active = strategy === m.key;
          const n = strategyCounts.get(m.key) ?? 0;
          return (
            <button
              key={m.key}
              onClick={() => setStrategy(active ? "ALL" : m.key)}
              title={`${m.trader} — ${m.blurb}`}
              className={`group shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                active
                  ? "border-[var(--ig-accent)]/50 bg-[var(--ig-accent)]/15 text-[var(--ig-accent)]"
                  : "border-white/10 text-white/50 hover:text-white"
              }`}
            >
              {m.label}
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${active ? "bg-[var(--ig-accent)]/20" : "bg-white/10 text-white/40"}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {activeStrategy && (
        <p className="mb-4 text-xs text-white/50">
          {STRATEGY_META.find((m) => m.key === activeStrategy)?.blurb} Entry/target/stop
          below are derived from this system&apos;s entry line through your risk settings.
        </p>
      )}

      {/* Fundamental ratio filters — combine with the technical signal above. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
        <span className="text-[11px] uppercase tracking-wider text-white/40">Fundamentals</span>
        <label className="flex items-center gap-2 text-xs text-white/60">
          ROCE ≥
          <input
            type="number"
            inputMode="decimal"
            value={minRoce}
            onChange={(e) => setMinRoce(e.target.value)}
            placeholder="20"
            className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--ig-primary)]"
          />
          %
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60">
          P/E ≤
          <input
            type="number"
            inputMode="decimal"
            value={maxPe}
            onChange={(e) => setMaxPe(e.target.value)}
            placeholder="any"
            className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--ig-primary)]"
          />
        </label>
        {(minRoce || maxPe) && (
          <button
            onClick={() => { setMinRoce(""); setMaxPe(""); }}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:text-white"
          >
            Clear
          </button>
        )}
        {!hasFundamentals && (
          <span className="text-[11px] text-amber-300/60">
            No fundamentals loaded yet — run the fundamentals ingestion to populate ROCE / P/E.
          </span>
        )}
      </div>

      <div className="mb-4 flex gap-6 text-xs text-white/50">
        <span>{counts.total} scanned</span>
        <span>{counts.setups} buy candidates</span>
        <span className="text-emerald-400">{counts.long} confirmed buy breakouts</span>
        <span className="ml-auto">{filtered.length} shown</span>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-white/10 px-4 py-10 text-center text-white/40">
          No matches.
        </div>
      )}

      {/* Desktop / tablet: full multi-column technical table (md and up). */}
      {filtered.length > 0 && (
        <div className="hidden overflow-x-auto rounded-2xl border border-white/10 md:block">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">Entry</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">Stop</th>
                <th className="px-4 py-3 text-right">Trail</th>
                <th className="px-4 py-3 text-right">R:R</th>
                <th className="px-4 py-3 text-right">~Days</th>
                <th className="px-4 py-3 text-right">P/E</th>
                <th className="px-4 py-3 text-right">Mkt Cap</th>
                <th className="px-4 py-3 text-right">ROCE</th>
                <th className="px-4 py-3 text-right">Profit Δ</th>
                <th className="px-4 py-3 text-right">Sales Δ</th>
                <th className="px-4 py-3 text-right">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const lv = effectiveLevels(r, activeStrategy);
                return (
                  <tr key={`${r.exchange}:${r.ticker}`} className="border-t border-white/5">
                    <td className="px-4 py-3">
                      <span className="font-semibold">{r.ticker}</span>
                      <span className="ml-2 text-[10px] uppercase text-white/30">{r.exchange} · {r.assetClass}</span>
                      {!activeStrategy && r.strategyTags.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {r.strategyTags.map((t) => (
                            <span
                              key={t}
                              title={STRATEGY_LABEL[t]}
                              className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium text-white/60"
                            >
                              {STRATEGY_LABEL[t]}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3"><ActionBadge dir={lv.dir} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmt2(lv.current)}
                      {r.quoteChangePct !== null && (
                        <span className={`ml-1 text-[10px] ${r.quoteChangePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {r.quoteChangePct >= 0 ? "+" : ""}{r.quoteChangePct.toFixed(2)}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-white/80">{fmt2(lv.entry)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-400">{fmt2(lv.target)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-400">{fmt2(lv.stopLoss)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-300/80">{fmt2(lv.trailingStop)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-white/60">
                      {lv.riskReward ? `${lv.riskReward.toFixed(1)}×` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-white/60">
                      {lv.expectedDays ? `${lv.expectedDays}d` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-white/70">{fmtRatio(r.peRatio)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-white/70">{fmtMarketCap(r.marketCap, r.financialCurrency)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${r.roce === null ? "text-white/30" : r.roce >= 20 ? "text-emerald-400" : "text-white/70"}`}>
                      {r.roce === null ? "—" : `${r.roce.toFixed(1)}%`}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${varColor(r.profitVarYoY)}`}>{fmtPct(r.profitVarYoY)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${varColor(r.salesVarYoY)}`}>{fmtPct(r.salesVarYoY)}</td>
                    <td className="px-4 py-3 text-right">
                      {activeStrategy ? (
                        <span className="rounded-full border border-[var(--ig-accent)]/40 bg-[var(--ig-accent)]/10 px-2.5 py-0.5 text-[11px] font-medium text-[var(--ig-accent)]">
                          {STRATEGY_LABEL[activeStrategy]}
                        </span>
                      ) : (
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${VERDICT_STYLE[r.verdict]}`}>
                          {formatVerdict(r.verdict)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile: stacked card list (below md) — no lateral scrolling. */}
      <div className="space-y-3 md:hidden">
        {filtered.map((r) => {
          const lv = effectiveLevels(r, activeStrategy);
          return (
            <div
              key={`${r.exchange}:${r.ticker}`}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
            >
              {/* Header: ticker + action + verdict/strategy */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold">{r.ticker}</span>
                    <span className="text-[10px] uppercase text-white/30">{r.exchange} · {r.assetClass}</span>
                    <ActionBadge dir={lv.dir} />
                  </div>
                  <div className="mt-1 tabular-nums">
                    <span className="text-lg font-bold">{fmt2(lv.current)}</span>
                    {r.quoteChangePct !== null && (
                      <span className={`ml-2 text-xs ${r.quoteChangePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {r.quoteChangePct >= 0 ? "+" : ""}{r.quoteChangePct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
                {activeStrategy ? (
                  <span className="shrink-0 rounded-full border border-[var(--ig-accent)]/40 bg-[var(--ig-accent)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--ig-accent)]">
                    {STRATEGY_LABEL[activeStrategy]}
                  </span>
                ) : (
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${VERDICT_STYLE[r.verdict]}`}>
                    {formatVerdict(r.verdict)}
                  </span>
                )}
              </div>

              {/* Strategy badges (when not already filtered by one) */}
              {!activeStrategy && r.strategyTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.strategyTags.map((t) => (
                    <span key={t} className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/60">
                      {STRATEGY_LABEL[t]}
                    </span>
                  ))}
                </div>
              )}

              {/* Levels grid — generous touch targets */}
              <div className="mt-3 grid grid-cols-3 gap-2 text-center tabular-nums">
                <div className="rounded-lg bg-black/30 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">Entry</div>
                  <div className="text-sm text-white/90">{fmt2(lv.entry)}</div>
                </div>
                <div className="rounded-lg bg-black/30 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">Target</div>
                  <div className="text-sm text-emerald-400">{fmt2(lv.target)}</div>
                </div>
                <div className="rounded-lg bg-black/30 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">Stop</div>
                  <div className="text-sm text-rose-400">{fmt2(lv.stopLoss)}</div>
                </div>
              </div>

              {/* Secondary metrics */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums text-white/50">
                <span>Trail <b className="text-amber-300/80">{fmt2(lv.trailingStop)}</b></span>
                <span>R:R <b className="text-white/70">{lv.riskReward ? `${lv.riskReward.toFixed(1)}×` : "—"}</b></span>
                <span>~{lv.expectedDays ? `${lv.expectedDays}d` : "—"}</span>
              </div>

              {/* Fundamentals — graceful "—" for rows without a report on file. */}
              <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-1 border-t border-white/5 pt-3 text-[11px] tabular-nums text-white/50">
                <span>P/E <b className="text-white/70">{fmtRatio(r.peRatio)}</b></span>
                <span>ROCE <b className={r.roce !== null && r.roce >= 20 ? "text-emerald-400" : "text-white/70"}>{r.roce === null ? "—" : `${r.roce.toFixed(1)}%`}</b></span>
                <span>Mkt <b className="text-white/70">{fmtMarketCap(r.marketCap, r.financialCurrency)}</b></span>
                <span>Profit Δ <b className={varColor(r.profitVarYoY)}>{fmtPct(r.profitVarYoY)}</b></span>
                <span>Sales Δ <b className={varColor(r.salesVarYoY)}>{fmtPct(r.salesVarYoY)}</b></span>
                {r.fundamentalsAsOf && <span className="text-white/30">{r.fundamentalsAsOf}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
