// Server-side screener: pulls every instrument that has price history, runs the
// swing classifier per name, and returns a ranked, filterable result set.
// Fetches OHLCV in pages to get past PostgREST's 1,000-row default cap.

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifySwingSetup } from "@/lib/analytics/swingClassifier";
import type { OHLCV } from "@/lib/types";

export interface ScreenRow {
  ticker: string;
  country: string;
  exchange: string;
  assetClass: string;
  verdict: string;
  score: number;
  close: number;
  bandwidthPct: number;
  isSqueeze: boolean;
  isBreakout: boolean;
  isLongBuildup: boolean;
  reason: string;
  asOf: string;
}

interface AssetMeta {
  ticker: string;
  country: string;
  exchange: string;
  asset_class: string;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

async function fetchAllOhlcv(supabase: SupabaseClient) {
  const PAGE = 1000;
  let from = 0;
  const rows: Record<string, unknown>[] = [];
  // Order by asset_id then date so each instrument's bars stay contiguous and
  // chronological across page boundaries.
  for (;;) {
    const { data, error } = await supabase
      .from("daily_ohlcv")
      .select(
        "asset_id,date,open,high,low,close,volume,open_interest, asset:assets!inner(ticker,country,exchange,asset_class)",
      )
      .order("asset_id", { ascending: true })
      .order("date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export async function runScreener(supabase: SupabaseClient): Promise<ScreenRow[]> {
  const rows = await fetchAllOhlcv(supabase);

  // Group bars by ticker, capturing each instrument's metadata once.
  const byTicker = new Map<string, { meta: AssetMeta; bars: OHLCV[] }>();
  for (const r of rows) {
    const meta = one<AssetMeta>(r.asset as AssetMeta | AssetMeta[] | null);
    if (!meta) continue;
    const key = `${meta.exchange}:${meta.ticker}`;
    if (!byTicker.has(key)) byTicker.set(key, { meta, bars: [] });
    byTicker.get(key)!.bars.push({
      date: r.date as string,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      openInterest: r.open_interest === null ? null : Number(r.open_interest),
    });
  }

  const out: ScreenRow[] = [];
  for (const { meta, bars } of byTicker.values()) {
    try {
      const s = classifySwingSetup(bars);
      out.push({
        ticker: meta.ticker,
        country: meta.country,
        exchange: meta.exchange,
        assetClass: meta.asset_class,
        verdict: s.verdict,
        score: s.score,
        close: s.close,
        bandwidthPct: s.bollinger.bandwidth * 100,
        isSqueeze: s.isSqueeze,
        isBreakout: s.isBreakout,
        isLongBuildup: s.isLongBuildup,
        reason: s.reasons[0],
        asOf: s.asOf,
      });
    } catch {
      // not enough bars for this instrument — skip
    }
  }

  // Active setups first (by score), then the rest alphabetically.
  out.sort((a, b) => {
    const aa = a.verdict === "NO_SETUP" ? 0 : 1;
    const bb = b.verdict === "NO_SETUP" ? 0 : 1;
    if (aa !== bb) return bb - aa;
    if (b.score !== a.score) return b.score - a.score;
    return a.ticker.localeCompare(b.ticker);
  });
  return out;
}
