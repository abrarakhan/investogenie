// Screener data: reads the precomputed swing_signals table (written by the scan
// job in lib/ingest/signals.ts), derives per-user trade levels from the stored
// raw fields, and attaches the live latest price + latest fundamentals. Direct
// SQL against the local Postgres.

import { query } from "@/lib/db";
import { getQuotesByAssetIds } from "@/lib/quotes";
import { getFundamentalsByAssetIds } from "@/lib/fundamentals";
import { deriveLevels, type SwingSetup, type TradeDirection } from "@/lib/analytics/swingClassifier";
import { strategyTradeLevels, type StrategyKey, type StrategyScore } from "@/lib/analytics/legendaryStrategies";
import { DEFAULT_SETTINGS, type SwingSettings } from "@/lib/settings";
import { isMarketOpenNow, latestSignalSessionDate, refreshMarketHolidays } from "@/lib/market-calendar.mjs";

/**
 * Where the live price stands against a plan's entry and stop:
 * - BELOW_STOP: the price is already through the stop; the plan is void until the next scan.
 * - EXTENDED: more than one ATR past the trigger; the plan would be a chase.
 * - BREAKOUT_CONFIRMED / BREAKOUT_UNCONFIRMED: the scan bar traded through the entry, with or
 *   without a close above it on 1.5x volume.
 */
export type EntryState = "BELOW_STOP" | "EXTENDED" | "BREAKOUT_CONFIRMED" | "BREAKOUT_UNCONFIRMED";

/** One ATR past the trigger is the furthest a breakout entry is still an entry. */
export const EXTENDED_ATR = 1;

export function entryState(input: {
  direction: TradeDirection; price: number; trigger: number | null; stop: number | null; atr: number;
  triggered?: boolean; confirmed?: boolean;
}): EntryState | null {
  const sign = input.direction === "LONG" ? 1 : -1;
  if (input.stop !== null && Number.isFinite(input.stop) && sign * (input.price - input.stop) <= 0) return "BELOW_STOP";
  if (input.trigger !== null && input.atr > 0 && sign * (input.price - input.trigger) > EXTENDED_ATR * input.atr) return "EXTENDED";
  if (input.triggered) return input.confirmed ? "BREAKOUT_CONFIRMED" : "BREAKOUT_UNCONFIRMED";
  if (input.trigger !== null && sign * (input.price - input.trigger) >= 0) return "BREAKOUT_UNCONFIRMED";
  return null;
}

/** Trade levels for one legendary strategy: its own entry, stop and trailing line,
 *  with the user's R:R setting the first target where the strategy has none. */
export interface StrategyLevel {
  /** Live price against this strategy's own trigger and stop. */
  state: EntryState | null;
  /** Breakout-day volume against the prior 50-session average, when the scan bar broke out. */
  breakoutVolumeRatio: number | null;
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
  /** OI for derivatives, VOLUME for cash equities (null until the next scan). */
  buildupSource: "OI" | "VOLUME" | null;
  participationRatio: number | null;
  volumeExpansion: number | null;
  breakoutClearanceAtr: number | null;
  rsRating: number | null;
  /** Normalized breakout quality used only to order equal scores. */
  rankScore: number | null;
  /** Live price against the default plan's trigger (EXTENDED) — null when in range. */
  entryState: EntryState | null;
  reason: string;
  asOf: string;
  entry: number | null;
  target: number | null;
  stopLoss: number | null;
  trailingStop: number | null;
  riskReward: number | null;
  expectedDays: number | null;
  strategyTags: StrategyKey[];
  strategyLevels: Record<string, StrategyLevel>;
  peRatio: number | null;
  marketCap: number | null;
  financialCurrency: string | null;
  roce: number | null;
  profitVarYoY: number | null;
  salesVarYoY: number | null;
  fundamentalsAsOf: string | null;
}

const SELECT =
  "asset_id,ticker,country,exchange,asset_class,verdict,score,last_close,bandwidth_pct,is_squeeze,is_breakout,is_long_buildup,reason,as_of,bias,current_price,atr,long_trigger,short_trigger,hh22,ll22,daily_velocity,strategy_tags,strategy_scores,buildup_source,participation_ratio,volume_expansion,breakout_clearance_atr,rs_rating,rank_score";

export async function runScreener(
  country?: string,
  settings: SwingSettings = DEFAULT_SETTINGS,
  opts: {
    exchange?: string;
    limit?: number;
    /** Select every row tagged by a legendary strategy instead of the default
     * classifier's setups. The strategy's own direction decides buy/short, so
     * neither the default verdict nor its bias filters these rows. */
    strategyMatches?: boolean;
    /** Every classifier setup (no NO_SETUP rows), without a row cap. */
    setupsOnly?: boolean;
    /** Assets kept even when the classifier calls them NO_SETUP (used with setupsOnly). */
    alsoAssetIds?: string[];
  } = {},
): Promise<ScreenRow[]> {
  if (country === "IN") await refreshMarketHolidays("IN");
  const market = country === "IN" || country === "US" ? country : null;
  const marketOpen = market ? isMarketOpenNow(market) : false;
  const params: unknown[] = [];
  const conds: string[] = [
    `exists (select 1 from public.assets a where a.id = swing_signals.asset_id and a.is_active)`,
    `not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id = swing_signals.asset_id)`,
  ];
  if (market) {
    params.push(latestSignalSessionDate(market));
    const expectedSessionParam = `$${params.length}::date`;
    // The signal itself must be current, not just the asset's bars and quote:
    // a stale row's ATR, trigger and verdict would otherwise be priced live.
    conds.push(`swing_signals.as_of >= ${expectedSessionParam}`);
    conds.push(`exists (select 1 from public.daily_ohlcv o where o.asset_id=swing_signals.asset_id and o.date >= ${expectedSessionParam})`);
    conds.push(`exists (
      select 1 from public.latest_quotes q
       where q.asset_id=swing_signals.asset_id
         and q.as_of::date >= ${expectedSessionParam}
         ${marketOpen ? "and q.updated_at >= now() - interval '7 minutes'" : ""}
    )`);
  } else {
    conds.push(`swing_signals.as_of >= current_date - interval '4 days'`);
    conds.push(`exists (select 1 from public.daily_ohlcv o where o.asset_id=swing_signals.asset_id and o.date >= current_date - interval '4 days')`);
    conds.push(`exists (select 1 from public.latest_quotes q where q.asset_id=swing_signals.asset_id and q.as_of::date >= current_date - interval '4 days')`);
  }
  if (country) { params.push(country); conds.push(`country = $${params.length}`); }
  if (opts.exchange) { params.push(opts.exchange); conds.push(`exchange = $${params.length}`); }
  if (opts.strategyMatches) {
    conds.push(settings.includeShort
      ? `cardinality(strategy_tags) > 0`
      : `exists (select 1 from jsonb_each(strategy_scores) s where s.value->>'dir' = 'LONG')`);
  } else {
    if (opts.setupsOnly && opts.alsoAssetIds?.length) {
      params.push(opts.alsoAssetIds);
      conds.push(`(verdict <> 'NO_SETUP' or swing_signals.asset_id = any($${params.length}::uuid[]))`);
    } else if (opts.limit || opts.setupsOnly) conds.push(`verdict <> 'NO_SETUP'`);
    if (!settings.includeShort) conds.push(`bias <> 'SHORT'`);
  }
  const where = conds.length ? `where ${conds.join(" and ")}` : "";
  let sql = `select ${SELECT} from public.swing_signals ${where} order by score desc, rank_score desc nulls last, ticker asc`;
  if (opts.limit) { params.push(opts.limit); sql += ` limit $${params.length}`; }

  const raw = await query<Record<string, unknown>>(sql, params);
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  const nullableNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const setupByAsset = new Map<string, SwingSetup>();
  const scoresByAsset = new Map<string, Record<string, StrategyScore>>();

  const deriveStrategyLevels = (
    setup: SwingSetup,
    rawScores: Record<string, StrategyScore>,
  ): Record<string, StrategyLevel> => {
    const levels: Record<string, StrategyLevel> = {};
    for (const [key, sc] of Object.entries(rawScores)) {
      const slv = strategyTradeLevels(setup, sc, settings);
      levels[key] = {
        state: entryState({
          direction: slv.direction, price: setup.currentPrice, atr: setup.atr,
          trigger: sc.entry ?? null, stop: slv.stopLoss,
          triggered: Boolean(sc.triggered), confirmed: Boolean(sc.confirmed),
        }),
        breakoutVolumeRatio: sc.triggered ? sc.volumeRatio ?? null : null,
        direction: slv.direction,
        entry: slv.entry,
        target: slv.target,
        stopLoss: slv.stopLoss,
        trailingStop: slv.trailingStop,
        riskReward: slv.riskRewardRatio,
        expectedDays: slv.expectedDays,
        score: Number(sc.score) || 0,
      };
    }
    return levels;
  };

  const out: ScreenRow[] = raw
    .filter((r) => opts.strategyMatches || settings.includeShort || (r.bias as string) !== "SHORT")
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

      const tags = Array.isArray(r.strategy_tags) ? (r.strategy_tags as StrategyKey[]) : [];
      const rawScores = (r.strategy_scores ?? {}) as Record<string, StrategyScore>;
      const assetId = r.asset_id as string;
      setupByAsset.set(assetId, setup);
      scoresByAsset.set(assetId, rawScores);

      return {
        assetId,
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
        buildupSource: r.buildup_source === "OI" || r.buildup_source === "VOLUME" ? r.buildup_source : null,
        participationRatio: nullableNum(r.participation_ratio),
        volumeExpansion: nullableNum(r.volume_expansion),
        breakoutClearanceAtr: nullableNum(r.breakout_clearance_atr),
        rsRating: nullableNum(r.rs_rating),
        rankScore: nullableNum(r.rank_score),
        entryState: null,
        reason: (r.reason as string) ?? "",
        asOf: r.as_of instanceof Date
          ? r.as_of.toISOString()
          : String(r.as_of ?? ""),
        entry: lv.entry,
        target: lv.target,
        stopLoss: lv.stopLoss,
        trailingStop: lv.trailingStop,
        riskReward: lv.riskRewardRatio,
        expectedDays: lv.expectedDays,
        strategyTags: tags,
        strategyLevels: deriveStrategyLevels(setup, rawScores),
        peRatio: null,
        marketCap: null,
        financialCurrency: null,
        roce: null,
        profitVarYoY: null,
        salesVarYoY: null,
        fundamentalsAsOf: null,
      };
    });

  out.sort((a, b) => {
    const aa = a.verdict === "NO_SETUP" ? 0 : 1;
    const bb = b.verdict === "NO_SETUP" ? 0 : 1;
    if (aa !== bb) return bb - aa;
    if (b.score !== a.score) return b.score - a.score;
    const rankDelta = (b.rankScore ?? Number.NEGATIVE_INFINITY) - (a.rankScore ?? Number.NEGATIVE_INFINITY);
    if (rankDelta > 0 || rankDelta < 0) return rankDelta;
    return a.ticker.localeCompare(b.ticker);
  });
  const rows = opts.limit ? out.slice(0, opts.limit) : out;

  const assetIds = rows.map((r) => r.assetId);
  const [quotes, fundamentals] = await Promise.all([
    getQuotesByAssetIds(assetIds),
    getFundamentalsByAssetIds(assetIds),
  ]);
  for (const r of rows) {
    const q = quotes.get(r.assetId);
    if (q) {
      r.lastQuote = q.price;
      r.quoteChangePct = q.changePct;
      const setup = setupByAsset.get(r.assetId);
      if (setup) {
        const liveSetup = { ...setup, currentPrice: q.price };
        const lv = deriveLevels(liveSetup, r.direction, settings);
        r.entry = lv.entry;
        r.target = lv.target;
        r.stopLoss = lv.stopLoss;
        r.trailingStop = lv.trailingStop;
        r.riskReward = lv.riskRewardRatio;
        r.expectedDays = lv.expectedDays;
        // The default plan re-bases its entry to the live price, so its stop is never crossed;
        // what it can be is a chase.
        r.entryState = r.verdict === "NO_SETUP" ? null : entryState({
          direction: r.direction, price: q.price, atr: setup.atr, stop: null,
          trigger: r.direction === "SHORT" ? setup.shortTrigger : setup.longTrigger,
        });
        r.strategyLevels = deriveStrategyLevels(
          liveSetup,
          scoresByAsset.get(r.assetId) ?? {},
        );
      }
    } else {
      r.entry = null;
      r.target = null;
      r.stopLoss = null;
      r.trailingStop = null;
      r.riskReward = null;
      r.expectedDays = null;
      r.strategyLevels = {};
    }
    const f = fundamentals.get(r.assetId);
    if (f) {
      r.peRatio = f.peRatio;
      r.marketCap = f.marketCap;
      r.financialCurrency = f.currency;
      r.roce = f.roce;
      r.profitVarYoY = f.profitVarianceYoY;
      r.salesVarYoY = f.salesVarianceYoY;
      r.fundamentalsAsOf = f.periodEndDate || null;
    }
  }
  return rows;
}
