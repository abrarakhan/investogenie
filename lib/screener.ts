// Screener data: reads the precomputed swing_signals table (written by the scan
// job in lib/ingest/signals.ts), derives per-user trade levels from the stored
// raw fields, and attaches the live latest price. Reading precomputed rows keeps
// the page fast even across the full universe.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuotesByAssetIds } from "@/lib/quotes";
import { getFundamentalsByAssetIds } from "@/lib/fundamentals";
import { deriveLevels, type SwingSetup, type TradeDirection } from "@/lib/analytics/swingClassifier";
import type { StrategyKey, StrategyScore } from "@/lib/analytics/legendaryStrategies";
import { DEFAULT_SETTINGS, type SwingSettings } from "@/lib/settings";

/** Trade levels for one legendary strategy, derived from its custom entry line
 *  through the user's read-time risk parameters. */
export interface StrategyLevel {
  direction: TradeDirection;
  entry: number;
  target: number;
  stopLoss: number;
  trailingStop: number;
  riskReward: number;
  expectedDays: number;
  score: number;
}

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
  /** Legendary systems this instrument matched on the latest scan. */
  strategyTags: StrategyKey[];
  /** Per-strategy levels keyed by strategy key (entry mapped through deriveLevels). */
  strategyLevels: Record<string, StrategyLevel>;
  // Latest-quarter corporate fundamentals (null when no report on file).
  peRatio: number | null;
  marketCap: number | null; // Rs. Cr
  roce: number | null; // %
  profitVarYoY: number | null; // %
  salesVarYoY: number | null; // %
  fundamentalsAsOf: string | null;
}

export async function runScreener(
  supabase: SupabaseClient,
  country?: string,
  settings: SwingSettings = DEFAULT_SETTINGS,
  opts: { exchange?: string; limit?: number } = {},
): Promise<ScreenRow[]> {
  const SELECT =
    "asset_id,ticker,country,exchange,asset_class,verdict,score,last_close,bandwidth_pct,is_squeeze,is_breakout,is_long_buildup,reason,as_of,bias,current_price,atr,long_trigger,short_trigger,hh22,ll22,daily_velocity,strategy_tags,strategy_scores";
  const raw: Record<string, unknown>[] = [];

  if (opts.limit) {
    // Top-N actionable candidates only — a single bounded query. Over-fetch a
    // little so the per-user short filter below can't shrink us under the cap.
    let query = supabase.from("swing_signals").select(SELECT).neq("verdict", "NO_SETUP");
    if (country) query = query.eq("country", country);
    if (opts.exchange) query = query.eq("exchange", opts.exchange);
    const { data } = await query
      .order("score", { ascending: false })
      .order("ticker", { ascending: true })
      .limit(opts.limit * 2);
    raw.push(...((data ?? []) as Record<string, unknown>[]));
  } else {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      let query = supabase.from("swing_signals").select(SELECT);
      if (country) query = query.eq("country", country);
      if (opts.exchange) query = query.eq("exchange", opts.exchange);
      const { data, error } = await query
        .order("score", { ascending: false })
        .order("ticker", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      raw.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
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

      // Map each matched strategy's custom entry through the user's risk params.
      const tags = Array.isArray(r.strategy_tags) ? (r.strategy_tags as StrategyKey[]) : [];
      const rawScores = (r.strategy_scores ?? {}) as Record<string, StrategyScore>;
      const strategyLevels: Record<string, StrategyLevel> = {};
      for (const [key, sc] of Object.entries(rawScores)) {
        const dir: TradeDirection = sc.dir === "SHORT" ? "SHORT" : "LONG";
        const trigger = sc.entry ?? (dir === "SHORT" ? setup.shortTrigger : setup.longTrigger);
        const stratSetup: SwingSetup =
          dir === "SHORT"
            ? { ...setup, shortTrigger: trigger }
            : { ...setup, longTrigger: trigger };
        const slv = deriveLevels(stratSetup, dir, settings);
        strategyLevels[key] = {
          direction: dir,
          entry: slv.entry,
          target: slv.target,
          stopLoss: slv.stopLoss,
          trailingStop: slv.trailingStop,
          riskReward: slv.riskRewardRatio,
          expectedDays: slv.expectedDays,
          score: Number(sc.score) || 0,
        };
      }

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
        strategyTags: tags,
        strategyLevels,
        peRatio: null,
        marketCap: null,
        roce: null,
        profitVarYoY: null,
        salesVarYoY: null,
        fundamentalsAsOf: null,
      };
    });

  // Rank setups-first by score, then keep only the top-N (when capped) before
  // the per-row quote/fundamental fetches.
  out.sort((a, b) => {
    const aa = a.verdict === "NO_SETUP" ? 0 : 1;
    const bb = b.verdict === "NO_SETUP" ? 0 : 1;
    if (aa !== bb) return bb - aa;
    if (b.score !== a.score) return b.score - a.score;
    return a.ticker.localeCompare(b.ticker);
  });
  const rows = opts.limit ? out.slice(0, opts.limit) : out;

  // Attach the live latest price + latest corporate fundamentals per instrument.
  const assetIds = rows.map((r) => r.assetId);
  const [quotes, fundamentals] = await Promise.all([
    getQuotesByAssetIds(supabase, assetIds),
    getFundamentalsByAssetIds(supabase, assetIds),
  ]);
  for (const r of rows) {
    const q = quotes.get(r.assetId);
    if (q) { r.lastQuote = q.price; r.quoteChangePct = q.changePct; }
    const f = fundamentals.get(r.assetId);
    if (f) {
      r.peRatio = f.peRatio;
      r.marketCap = f.marketCap;
      r.roce = f.roce;
      r.profitVarYoY = f.profitVarianceYoY;
      r.salesVarYoY = f.salesVarianceYoY;
      r.fundamentalsAsOf = f.periodEndDate || null;
    }
  }
  return rows;
}
