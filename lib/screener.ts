// Screener data: reads the precomputed swing_signals table (written by the scan
// job in lib/ingest/signals.ts) and attaches the live latest price. Reading
// precomputed rows keeps the page fast even across the full universe.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuotesByAssetIds } from "@/lib/quotes";

export interface ScreenRow {
  assetId: string;
  ticker: string;
  country: string;
  exchange: string;
  assetClass: string;
  verdict: string;
  score: number;
  close: number;
  lastQuote: number | null;
  quoteChangePct: number | null;
  bandwidthPct: number;
  isSqueeze: boolean;
  isBreakout: boolean;
  isLongBuildup: boolean;
  reason: string;
  asOf: string;
}

export async function runScreener(
  supabase: SupabaseClient,
  country?: string,
): Promise<ScreenRow[]> {
  // Page through swing_signals (one row per instrument), highest score first.
  const PAGE = 1000;
  let from = 0;
  const raw: Record<string, unknown>[] = [];
  for (;;) {
    let query = supabase
      .from("swing_signals")
      .select(
        "asset_id,ticker,country,exchange,asset_class,verdict,score,last_close,bandwidth_pct,is_squeeze,is_breakout,is_long_buildup,reason,as_of",
      );
    if (country) query = query.eq("country", country);
    const { data, error } = await query
      .order("score", { ascending: false })
      .order("ticker", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    raw.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const out: ScreenRow[] = raw.map((r) => ({
    assetId: r.asset_id as string,
    ticker: r.ticker as string,
    country: r.country as string,
    exchange: r.exchange as string,
    assetClass: r.asset_class as string,
    verdict: r.verdict as string,
    score: Number(r.score),
    close: Number(r.last_close),
    lastQuote: null,
    quoteChangePct: null,
    bandwidthPct: Number(r.bandwidth_pct),
    isSqueeze: Boolean(r.is_squeeze),
    isBreakout: Boolean(r.is_breakout),
    isLongBuildup: Boolean(r.is_long_buildup),
    reason: (r.reason as string) ?? "",
    asOf: (r.as_of as string) ?? "",
  }));

  // Attach the live latest price for each scanned instrument.
  const quotes = await getQuotesByAssetIds(supabase, out.map((r) => r.assetId));
  for (const r of out) {
    const q = quotes.get(r.assetId);
    if (q) { r.lastQuote = q.price; r.quoteChangePct = q.changePct; }
  }

  // Active setups first (by score), then the rest.
  out.sort((a, b) => {
    const aa = a.verdict === "NO_SETUP" ? 0 : 1;
    const bb = b.verdict === "NO_SETUP" ? 0 : 1;
    if (aa !== bb) return bb - aa;
    if (b.score !== a.score) return b.score - a.score;
    return a.ticker.localeCompare(b.ticker);
  });
  return out;
}
