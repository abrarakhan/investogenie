"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PRESETS } from "@/lib/screener/presets";
import type { ScreenerStock, Market } from "@/lib/screener/service";
import { fmtPct, fmtPrice, signColor } from "./format";

// Compact dashboard widget: top 5 gainers & losers (default) from a universe,
// with a dropdown to switch to any other preset (single top-5 list). Self-
// fetching from /api/screener so it can drop into any server page.

async function fetchTop(market: Market, universe: string, presetKey: string | null): Promise<ScreenerStock[]> {
  const preset = presetKey ? PRESETS.find((p) => p.key === presetKey) : null;
  const res = await fetch("/api/screener", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      market, universe,
      filters: preset?.filters ?? [],
      sort: preset?.sort ?? { field: "change_pct_1d", dir: "desc" },
      valueBelowSectorMedian: preset?.dynamic === "value",
      page: 1, pageSize: 5,
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.rows ?? []) as ScreenerStock[];
}

function MiniRow({ row, market }: { row: ScreenerStock; market: Market }) {
  return (
    <Link href={`/terminal/${market.toLowerCase()}/stocks`} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-white/5">
      <span className="truncate font-medium text-white/80">{row.symbol}</span>
      <span className="flex items-center gap-2 tabular-nums">
        <span className="text-white/50">{fmtPrice(row.ltp, row.currency)}</span>
        <span className={`${signColor(row.change_pct_1d)} w-16 text-right`}>{fmtPct(row.change_pct_1d)}</span>
      </span>
    </Link>
  );
}

export default function ScreenerWidget({
  market = "IN", universe = "NIFTY_500",
}: {
  market?: Market; universe?: string;
}) {
  const [presetKey, setPresetKey] = useState<string>("__movers__");
  const [gainers, setGainers] = useState<ScreenerStock[]>([]);
  const [losers, setLosers] = useState<ScreenerStock[]>([]);
  const [single, setSingle] = useState<ScreenerStock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      if (presetKey === "__movers__") {
        const [g, l] = await Promise.all([
          fetchTop(market, universe, "top_gainers"),
          fetchTop(market, universe, "top_losers"),
        ]);
        if (!alive) return;
        setGainers(g); setLosers(l); setSingle([]);
      } else {
        const rows = await fetchTop(market, universe, presetKey);
        if (!alive) return;
        setSingle(rows); setGainers([]); setLosers([]);
      }
      if (alive) setLoading(false);
    };
    load();
    return () => { alive = false; };
  }, [market, universe, presetKey]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white/80">Screener</span>
          <span className="text-[11px] text-white/30">Nifty 500</span>
        </div>
        <select
          value={presetKey}
          onChange={(e) => setPresetKey(e.target.value)}
          className="rounded-md border border-white/10 bg-[#0a0e17] px-2 py-1 text-xs text-white/70"
        >
          <option value="__movers__">Gainers &amp; Losers</option>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-1">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-6 animate-pulse rounded bg-white/5" />)}</div>
      ) : presetKey === "__movers__" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-emerald-400/70">Top gainers</div>
            {gainers.length ? gainers.map((r) => <MiniRow key={r.asset_id} row={r} market={market} />) : <div className="px-2 text-xs text-white/30">—</div>}
          </div>
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-rose-400/70">Top losers</div>
            {losers.length ? losers.map((r) => <MiniRow key={r.asset_id} row={r} market={market} />) : <div className="px-2 text-xs text-white/30">—</div>}
          </div>
        </div>
      ) : (
        <div>{single.length ? single.map((r) => <MiniRow key={r.asset_id} row={r} market={market} />) : <div className="px-2 text-xs text-white/30">No matches</div>}</div>
      )}

      <Link href={`/terminal/${market.toLowerCase()}/stocks`} className="mt-3 block text-center text-[11px] font-semibold text-[var(--ig-accent,#22d3ee)] hover:underline">
        Open full screener →
      </Link>
    </div>
  );
}
