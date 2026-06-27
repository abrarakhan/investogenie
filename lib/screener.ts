// Screener data: reads the precomputed swing_signals table (written by the scan
// job in lib/ingest/signals.ts), derives per-user trade levels from the stored
// raw fields, and attaches the live latest price + latest fundamentals. Direct
// SQL against the local Postgres.

import { query } from "@/lib/db";
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
  strategyTags: StrategyKey[];
  strategyLevels: Record<string, StrategyLevel>;
  peRatio: number | null;
  marketCap: number | null;
  roce: number | null;
  profitVarYoY: number | null;
  salesVarYoY: number | null;
  fundamentalsAsOf: string | null;
}

const SELECT =
  "asset_id,ticker,country,exchange,asset_class,verdict,score,last_close,bandwidth_pct,is_squeeze,is_breakout,is_long_buildup,reason,as_of,bias,current_price,atr,long_trigger,short_trigger,hh22,ll22,daily_velocity,strategy_tags,strategy_scores";

export async function runScreener(
  country?: string,
  settings: SwingSettings = DEFAULT_SETTINGS,
  opts: { exchange?: string; limit?: number } = {},
): Promise<ScreenRow[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (country) { params.push(country); conds.push(`country = $${params.length}`); }
  if (opts.exchange) { params.push(opts.exchange); conds.push(`exchange = $${params.length}`); }
  if (opts.limit) conds.push(`verdict <> 'NO_SETUP'`);
  const where = conds.length ? `where ${conds.join(" and ")}` : "";
  let sql = `select ${SELECT} from public.swing_signals ${where} order by score desc, ticker asc`;
  if (opts.limit) { params.push(opts.limit * 2); sql += ` limit $${params.length}`; }

  const raw = await query<Record<string, unknown>>(sql, params);
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  const setupByAsset = new Map<string, SwingSetup>();
  const scoresByAsset = new Map<string, Record<string, StrategyScore>>();

  const deriveStrategyLevels = (
    setup: SwingSetup,
    rawScores: Record<string, StrategyScore>,
  ): Record<string, StrategyLevel> => {
    const levels: Record<string, StrategyLevel> = {};
    for (const [key, sc] of Object.entries(rawScores)) {
      const dir: TradeDirection = sc.dir === "SHORT" ? "SHORT" : "LONG";
      const trigger = sc.entry ?? (dir === "SHORT" ? setup.shortTrigger : setup.longTrigger);
      const stratSetup: SwingSetup =
        dir === "SHORT" ? { ...setup, shortTrigger: trigger } : { ...setup, longTrigger: trigger };
      const slv = deriveLevels(stratSetup, dir, settings);
      levels[key] = {
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
    return levels;
  };

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
        reason: (r.reason as string) ?? "",
        asOf: (r.as_of as string) ?? "",
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
      r.roce = f.roce;
      r.profitVarYoY = f.profitVarianceYoY;
      r.salesVarYoY = f.salesVarianceYoY;
      r.fundamentalsAsOf = f.periodEndDate || null;
    }
  }
  return rows;
}
