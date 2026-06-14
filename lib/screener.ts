// Screener data: reads the precomputed swing_signals table (written by the scan
// job in lib/ingest/signals.ts), derives per-user trade levels from the stored
// raw fields, and attaches the live latest price. Reading precomputed rows keeps
// the page fast even across the full universe.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuotesByAssetIds } from "@/lib/quotes";
import { deriveLevels, type SwingSetup, type TradeDirection } from "@/lib/analytics/swingClassifier";
import { DEFAULT_SETTINGS, type SwingSettings } from "@/lib/settings";

export interface ScreenRow {
  assetId: string;
  ticker: string;
  country: string;
  exchange: string;
  assetClass: string;
  verdict: string;
  direction: TradeDirection;
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
  entry: number | null;
  target: number | null;
  stopLoss: number | null;
  trailingStop: number | null;
  riskReward: number | null;
  expectedDays: number | null;
}

export async function runScreener(
  supabase: SupabaseClient,
  country?: string,
  settings: SwingSettings = DEFAULT_SETTINGS,
): Promise<ScreenRow[]> {
  const PAGE = 1000;
  let from = 0;
  const raw: Record<string, unknown>[] = [];
  for (;;) {
    let query = supabase
      .from("swing_signals")
      .select(
        "asset_id,ticker,country,exchange,asset_class,verdict,score,last_close,bandwidth_pct,is_squeeze,is_breakout,is_long_buildup,reason,as_of,bias,current_price,atr,long_trigger,short_trigger,hh22,ll22,daily_velocity",
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

  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

  const out: ScreenRow[] = raw
    .filter((r) => settings.includeShort || (r.bias as string) !== "SHORT")
    .map((r) => {
      const direction: TradeDirection = (r.bias as string) === "SHORT" ? "SHORT" : "LONG";
      const setup: SwingSetup = {
        currentPrice: num(r.current_price) || num(r.last_close),
        atr: num(r.atr),
        longTrigger: num(r.long_trigger),
        shortTrigger: num(r.short_trigger),
        hh22: num(r.hh22),
        ll22: num(r.ll22),
        dailyVelocity: num(r.daily_velocity),
      };
      const lv = deriveLevels(setup, direction, settings);
      return {
        assetId: r.asset_id as string,
        ticker: r.ticker as string,
        country: r.country as string,
        exchange: r.exchange as string,
        assetClass: r.asset_class as string,
        verdict: r.verdict as string,
        direction,
        score: num(r.score),
        close: num(r.last_close),
        lastQuote: null,
        quoteChangePct: null,
        bandwidthPct: num(r.bandwidth_pct),
        isSqueeze: Boolean(r.is_squeeze),
        isBreakout: Boolean(r.is_breakout),
        isLongBuildup: Boolean(r.is_long_buildup),
        reason: (r.reason as string) ?? "",
        asOf: (r.as_of as string) ?? "",
        entry: lv.entry,
        target: lv.target,
        stopLoss: lv.stopLoss,
        trailingStop: lv.trailingStop,
        riskReward: lv.riskRewardRatio,
        expectedDays: lv.expectedDays,
      };
    });

  // Attach the live latest price for each scanned instrument.
  const quotes = await getQuotesByAssetIds(supabase, out.map((r) => r.assetId));
  for (const r of out) {
    const q = quotes.get(r.assetId);
    if (q) { r.lastQuote = q.price; r.quoteChangePct = q.changePct; }
  }

  out.sort((a, b) => {
    const aa = a.verdict === "NO_SETUP" ? 0 : 1;
    const bb = b.verdict === "NO_SETUP" ? 0 : 1;
    if (aa !== bb) return bb - aa;
    if (b.score !== a.score) return b.score - a.score;
    return a.ticker.localeCompare(b.ticker);
  });
  return out;
}
