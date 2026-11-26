import { query } from "@/lib/db";
import { MARKETS, MARKET_COUNTRY } from "@/lib/markets";
import type { MarketId } from "@/lib/types";

export type TacticalBucketKey = "NEAR_TRIGGER" | "MID_TREND_PULLBACK" | "OVERSOLD_SNAPBACK";
export type TacticalRiskTier = "MODERATE" | "HIGHER_MEAN_REVERSION";
export type TacticalMarketRegime = "TREND_BREAKOUT" | "CHOPPY_ROTATION" | "SNAPBACK_REVERSAL" | "DEFENSIVE";

export interface TacticalMarketContext {
  regime: TacticalMarketRegime;
  regimeLabel: string;
  summary: string;
  favoredBucket: TacticalBucketKey;
  benchmarkTicker: string;
  benchmarkPrice: number | null;
  benchmarkChangePct: number | null;
  benchmarkAboveSma50: boolean | null;
  advancers: number;
  decliners: number;
  breadthPct: number | null;
  asOfDate: string | null;
}

export interface TacticalCandidate {
  assetId: string;
  ticker: string;
  name: string;
  exchange: string;
  sector: string | null;
  bucket: TacticalBucketKey;
  riskTier: TacticalRiskTier;
  score: number;
  price: number;
  changePct: number | null;
  referenceEntry: number;
  invalidationStop: number;
  targetZone: number;
  riskPct: number;
  rsi14: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  return5d: number | null;
  return20d: number | null;
  distanceSma20Pct: number | null;
  distanceSma200Pct: number | null;
  engines: string[];
  confluenceCount: number;
  reason: string;
  newsNote: string | null;
  asOfDate: string | null;
}

export interface TacticalRadarResult {
  market: MarketId;
  generatedAt: string;
  context: TacticalMarketContext;
  buckets: Record<TacticalBucketKey, TacticalCandidate[]>;
  excludedCounts: {
    adverseNews: number;
    resultsBlackout: number;
  };
}

export const TACTICAL_BUCKET_META: Record<
  TacticalBucketKey,
  {
    label: string;
    shortLabel: string;
    riskLabel: string;
    riskTier: TacticalRiskTier;
    description: string;
  }
> = {
  NEAR_TRIGGER: {
    label: "Near-Trigger Breakouts",
    shortLabel: "Near-Trigger",
    riskLabel: "Moderate Risk",
    riskTier: "MODERATE",
    description:
      "Strong Swing setups 1-2 timing gates away, Momentum Ignition early-watch/pre-ignition names, Trend Continuation watches, and Swing breakouts ranked by multi-engine confluence.",
  },
  MID_TREND_PULLBACK: {
    label: "Mid-Trend Pullbacks",
    shortLabel: "Pullbacks",
    riskLabel: "Moderate Risk",
    riskTier: "MODERATE",
    description:
      "Stocks trading above SMA20, SMA50, and SMA200 with constructive 20-day momentum pausing without over-extension.",
  },
  OVERSOLD_SNAPBACK: {
    label: "Oversold Snapbacks",
    shortLabel: "Snapbacks",
    riskLabel: "Higher Risk · Mean Reversion",
    riskTier: "HIGHER_MEAN_REVERSION",
    description:
      "Beaten-down stocks (RSI <= 42) holding near structural 200-day support with early stabilization. Separate from trend breakouts and sized with tighter invalidation levels.",
  },
};

const HARD_DISQUALIFYING_STRONG_GATES = new Set([
  "price",
  "liquidity",
  "results_blackout",
  "market_shock",
  "circuit_behaviour",
  "extension_5d",
  "extension_10d",
  "freshness",
]);

const TIMING_ONLY_STRONG_GATES = new Set([
  "follow_through",
  "entry_zone",
  "session_hold",
  "session_reversal",
  "live_spread",
  "live_quote",
  "live_circuit",
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function classifyMarketRegime(input: {
  benchmarkAboveSma50: boolean | null;
  benchmarkChangePct: number | null;
  advancers: number;
  decliners: number;
}): Pick<TacticalMarketContext, "regime" | "regimeLabel" | "summary" | "favoredBucket" | "breadthPct"> {
  const total = input.advancers + input.decliners;
  const breadthPct = total > 0 ? round2((input.advancers / total) * 100) : null;
  const above50 = input.benchmarkAboveSma50;
  const chg = input.benchmarkChangePct ?? 0;

  if (above50 !== false && breadthPct !== null && breadthPct >= 55) {
    return {
      regime: "TREND_BREAKOUT",
      regimeLabel: "Trend / Breakout Tape",
      summary: "Benchmark holds above 50DMA with positive breadth — favors Near-Trigger Breakouts and Mid-Trend Pullbacks.",
      favoredBucket: "NEAR_TRIGGER",
      breadthPct,
    };
  }

  if ((above50 === false || (breadthPct !== null && breadthPct < 42)) && chg >= 0.35) {
    return {
      regime: "SNAPBACK_REVERSAL",
      regimeLabel: "Snapback / Reversal Tape",
      summary: "Index rebounding from a weak base — Oversold Snapbacks often lead intraday moves while trend setups stay selective.",
      favoredBucket: "OVERSOLD_SNAPBACK",
      breadthPct,
    };
  }

  if (above50 === false && (breadthPct === null || breadthPct < 45) && chg < 0.35) {
    return {
      regime: "DEFENSIVE",
      regimeLabel: "Defensive / Weak Tape",
      summary: "Benchmark below 50DMA with weak breadth — treat all tactical setups with smaller size and tight invalidation levels.",
      favoredBucket: "NEAR_TRIGGER",
      breadthPct,
    };
  }

  return {
    regime: "CHOPPY_ROTATION",
    regimeLabel: "Choppy / Rotation Tape",
    summary: "Mixed breadth with selective sector strength — focus on multi-engine Near-Trigger leaders and clean Mid-Trend Pullbacks.",
    favoredBucket: "MID_TREND_PULLBACK",
    breadthPct,
  };
}

export function evaluateStrongSwingNearTrigger(gates: unknown): {
  eligible: boolean;
  failedTimingGates: string[];
  failedOtherGates: string[];
} {
  if (!Array.isArray(gates)) {
    return { eligible: false, failedTimingGates: [], failedOtherGates: ["missing_gates"] };
  }
  const failedTimingGates: string[] = [];
  const failedOtherGates: string[] = [];

  for (const raw of gates) {
    if (!raw || typeof raw !== "object") continue;
    const gate = raw as { key?: string; passed?: boolean; blocking?: boolean };
    if (gate.passed !== false || gate.blocking === false || !gate.key) continue;
    if (HARD_DISQUALIFYING_STRONG_GATES.has(gate.key)) {
      return { eligible: false, failedTimingGates, failedOtherGates: [gate.key] };
    }
    if (TIMING_ONLY_STRONG_GATES.has(gate.key)) {
      failedTimingGates.push(gate.key);
    } else {
      failedOtherGates.push(gate.key);
    }
  }

  // Allow up to 1 non-hard technical miss (e.g. volume or trend) + timing misses so strong 85+ setups surface.
  const eligible = failedOtherGates.length <= 1;
  return { eligible, failedTimingGates, failedOtherGates };
}

export function computeAtrLevels(
  price: number,
  atrPct: number | null,
  mode: "TREND" | "SNAPBACK",
  sma20?: number | null,
): { referenceEntry: number; invalidationStop: number; targetZone: number; riskPct: number } {
  const safeAtrPct = Math.min(8, Math.max(1.5, atrPct ?? 3.0));
  const stopMult = mode === "SNAPBACK" ? 1.2 : 1.5;
  const rrMult = mode === "SNAPBACK" ? 1.8 : 2.0;
  const stopDist = price * ((safeAtrPct * stopMult) / 100);
  const invalidationStop = round2(Math.max(0.01, price - stopDist));
  const risk = Math.max(0.01, price - invalidationStop);
  let targetZone = round2(price + risk * rrMult);
  if (mode === "SNAPBACK" && sma20 && sma20 > price * 1.03) {
    // Cap snapback target near mean-reversion magnet if reasonable, else 1.8R
    targetZone = round2(Math.max(targetZone, sma20));
  }
  const riskPct = round2((risk / price) * 100);
  return { referenceEntry: round2(price), invalidationStop, targetZone, riskPct };
}

interface BreadthRow {
  advancers: string | number;
  decliners: string | number;
  latest_as_of: string | Date | null;
}

interface BenchRow {
  ticker: string;
  price: string | number;
  change_pct: string | number | null;
  distance_sma_50_pct: string | number | null;
}

interface StrongSnapRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  status: string;
  strength_score: string | number;
  current_price: string | number | null;
  confirmation_entry: string | number | null;
  projected_target: string | number | null;
  projected_stop: string | number | null;
  gates: unknown;
  latest_bar_date: string | Date | null;
  live_price: string | number | null;
  live_change_pct: string | number | null;
  rsi_14: string | number | null;
  atr_pct_14: string | number | null;
  volume_ratio_20: string | number | null;
  return_5d: string | number | null;
  return_20d: string | number | null;
  distance_sma_20_pct: string | number | null;
  distance_sma_200_pct: string | number | null;
}

interface ObservationRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  engine: string;
  status: string;
  observed_at: string | Date;
  live_price: string | number | null;
  live_change_pct: string | number | null;
  close: string | number | null;
  rsi_14: string | number | null;
  atr_pct_14: string | number | null;
  volume_ratio_20: string | number | null;
  return_5d: string | number | null;
  return_20d: string | number | null;
  distance_sma_20_pct: string | number | null;
  distance_sma_200_pct: string | number | null;
  tech_date: string | Date | null;
}

interface TrendRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  status: string;
  score: string | number;
  entry: string | number | null;
  stop: string | number | null;
  target: string | number | null;
  asof_market_date: string | Date;
  setup_variant: string | null;
  live_price: string | number | null;
  live_change_pct: string | number | null;
  rsi_14: string | number | null;
  atr_pct_14: string | number | null;
  volume_ratio_20: string | number | null;
  return_5d: string | number | null;
  return_20d: string | number | null;
  distance_sma_20_pct: string | number | null;
  distance_sma_200_pct: string | number | null;
}

interface SwingBreakoutRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  score: string | number;
  last_close: string | number;
  as_of: string | Date;
  live_price: string | number | null;
  live_change_pct: string | number | null;
  rsi_14: string | number | null;
  atr_pct_14: string | number | null;
  volume_ratio_20: string | number | null;
  return_5d: string | number | null;
  return_20d: string | number | null;
  distance_sma_20_pct: string | number | null;
  distance_sma_200_pct: string | number | null;
}

interface TechScanRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  date: string | Date;
  close: string | number;
  sma_20: string | number | null;
  rsi_14: string | number | null;
  atr_pct_14: string | number | null;
  volume_ratio_20: string | number | null;
  return_5d: string | number | null;
  return_20d: string | number | null;
  distance_sma_20_pct: string | number | null;
  distance_sma_50_pct: string | number | null;
  distance_sma_200_pct: string | number | null;
  ibs_close: string | number | null;
  live_price: string | number | null;
  live_change_pct: string | number | null;
  market_cap: string | number | null;
}

interface ExclusionRow {
  asset_id: string;
  verdict?: string;
  summary?: string | null;
  catalyst_note?: string | null;
}

function exchangeRank(exchange: string | null): number {
  if (exchange === "NSE" || exchange === "NASDAQ" || exchange === "NYSE") return 2;
  if (exchange === "BSE") return 1;
  return 0;
}

export async function getTacticalRadar(market: MarketId, limitPerBucket = 10): Promise<TacticalRadarResult> {
  const country = MARKET_COUNTRY[market];
  const priceFloor = market === "IN" ? 20 : 2;
  const mcapFloor = market === "IN" ? 5_000_000_000 : 300_000_000; // ₹500 Cr IN / $300M US liquidity proxy
  const benchmarkTickers = market === "IN" ? ["NIFTY", "NIFTYBEES"] : ["SPY"];

  const [
    breadthRows,
    benchRows,
    adverseNewsRows,
    resultsBlackoutRows,
    strongRows,
    obsRows,
    trendRows,
    swingRows,
    pullbackRows,
    snapbackRows,
  ] = await Promise.all([
    query<BreadthRow>(
      `select
         count(*) filter (where q.change_pct > 0) as advancers,
         count(*) filter (where q.change_pct < 0) as decliners,
         max(q.as_of) as latest_as_of
       from public.assets a
       join public.latest_quotes q on q.asset_id = a.id
       where a.country = $1 and a.is_active = true and a.asset_class = 'STOCK'`,
      [country],
    ).catch(() => []),

    query<BenchRow>(
      `select a.ticker, q.price, q.change_pct, td.distance_sma_50_pct
       from public.assets a
       join public.latest_quotes q on q.asset_id = a.id
       left join lateral (
         select distance_sma_50_pct
         from public.screener_technical_daily
         where asset_id = a.id
         order by date desc limit 1
       ) td on true
       where a.country = $1 and a.ticker = any($2)
       order by array_position($2::text[], a.ticker) asc
       limit 1`,
      [country, benchmarkTickers],
    ).catch(() => []),

    query<ExclusionRow>(
      `select asset_id, verdict, summary, catalyst_note
       from public.news_stock_briefs
       where market = $1 and generated_at >= now() - interval '72 hours'`,
      [market],
    ).catch(() => []),

    query<{ asset_id: string }>(
      `select distinct asset_id
       from public.corporate_events
       where event_type = 'RESULTS'
         and event_date between current_date - interval '1 day' and current_date + interval '3 days'`,
    ).catch(() => []),

    query<StrongSnapRow>(
      `with latest_ts as (
         select max(captured_at) as ts
         from public.strong_swing_snapshots
         where market = $1
       ),
       latest_td as (
         select distinct on (asset_id) asset_id, rsi_14, atr_pct_14, volume_ratio_20,
                return_5d, return_20d, distance_sma_20_pct, distance_sma_200_pct
         from public.screener_technical_daily
         where date >= current_date - interval '14 days'
         order by asset_id, date desc
       )
       select s.asset_id, a.ticker, a.name, a.exchange, a.sector, s.status,
              s.strength_score, s.current_price, s.confirmation_entry, s.projected_target,
              s.projected_stop, s.gates, s.latest_bar_date,
              q.price as live_price, q.change_pct as live_change_pct,
              td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
              td.distance_sma_20_pct, td.distance_sma_200_pct
       from public.strong_swing_snapshots s
       join latest_ts lt on s.captured_at = lt.ts
       join public.assets a on a.id = s.asset_id
       left join public.latest_quotes q on q.asset_id = s.asset_id
       left join latest_td td on td.asset_id = s.asset_id
       where s.market = $1
         and s.status <> 'INVALIDATED'
         and s.strength_score >= 82
       order by s.strength_score desc, s.rank asc
       limit 80`,
      [market],
    ).catch(() => []),

    query<ObservationRow>(
      `with latest_td as (
         select distinct on (asset_id) asset_id, close, rsi_14, atr_pct_14, volume_ratio_20,
                return_5d, return_20d, distance_sma_20_pct, distance_sma_200_pct, date
         from public.screener_technical_daily
         where date >= current_date - interval '14 days'
         order by asset_id, date desc
       )
       select distinct on (o.asset_id, o.engine)
              o.asset_id, a.ticker, a.name, a.exchange, a.sector,
              o.engine, o.status, o.observed_at,
              q.price as live_price, q.change_pct as live_change_pct,
              td.close, td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
              td.distance_sma_20_pct, td.distance_sma_200_pct, td.date as tech_date
       from public.candidate_signal_observations o
       join public.assets a on a.id = o.asset_id
       left join public.latest_quotes q on q.asset_id = o.asset_id
       left join latest_td td on td.asset_id = o.asset_id
       where o.market = $1
         and o.observed_at >= now() - interval '72 hours'
         and o.engine in ('MOMENTUM_IGNITION', 'MOMENTUM_IGNITION_V2', 'TREND_CONTINUATION')
         and o.status in ('EARLY_WATCH', 'PRE_IGNITION', 'FIRST_THRUST', 'RETEST_SETUP', 'IMPULSE_DETECTED', 'CONTINUATION_WATCH', 'TREND_CONTINUATION_READY')
       order by o.asset_id, o.engine, o.observed_at desc
       limit 120`,
      [market],
    ).catch(() => []),

    market === "IN"
      ? query<TrendRow>(
          `with latest_td as (
             select distinct on (asset_id) asset_id, rsi_14, atr_pct_14, volume_ratio_20,
                    return_5d, return_20d, distance_sma_20_pct, distance_sma_200_pct
             from public.screener_technical_daily
             where date >= current_date - interval '14 days'
             order by asset_id, date desc
           )
           select distinct on (t.asset_id)
                  t.asset_id, a.ticker, a.name, a.exchange, a.sector,
                  t.status, t.score, t.entry, t.stop, t.target, t.asof_market_date, t.setup_variant,
                  q.price as live_price, q.change_pct as live_change_pct,
                  td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
                  td.distance_sma_20_pct, td.distance_sma_200_pct
           from public.trend_continuation_signals t
           join public.assets a on a.id = t.asset_id
           left join public.latest_quotes q on q.asset_id = t.asset_id
           left join latest_td td on td.asset_id = t.asset_id
           where t.market = 'IN'
             and t.asof_market_date >= current_date - interval '5 days'
             and t.status in ('TREND_CONTINUATION_READY', 'IMPULSE_DETECTED', 'CONTINUATION_WATCH')
             and t.score >= 65
           order by t.asset_id, t.asof_market_date desc, t.score desc
           limit 60`,
        ).catch(() => [])
      : Promise.resolve([]),

    query<SwingBreakoutRow>(
      `with latest_asof as (
         select max(as_of) as dt from public.swing_signals where country = $1
       ),
       latest_td as (
         select distinct on (asset_id) asset_id, rsi_14, atr_pct_14, volume_ratio_20,
                return_5d, return_20d, distance_sma_20_pct, distance_sma_200_pct
         from public.screener_technical_daily
         where date >= current_date - interval '14 days'
         order by asset_id, date desc
       )
       select s.asset_id, a.ticker, a.name, a.exchange, a.sector, s.score, s.last_close, s.as_of,
              q.price as live_price, q.change_pct as live_change_pct,
              td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
              td.distance_sma_20_pct, td.distance_sma_200_pct
       from public.swing_signals s
       join latest_asof la on s.as_of = la.dt
       join public.assets a on a.id = s.asset_id
       left join public.latest_quotes q on q.asset_id = s.asset_id
       left join latest_td td on td.asset_id = s.asset_id
       left join public.screener_fundamental_latest f on f.asset_id = s.asset_id
       where s.country = $1
         and s.verdict = 'LONG_BREAKOUT'
         and s.score >= 0.55
         and s.last_close >= $2
         and (f.market_cap is null or f.market_cap >= $3)
       order by s.score desc, coalesce(td.volume_ratio_20, 0) desc
       limit 60`,
      [country, priceFloor, mcapFloor],
    ).catch(() => []),

    // Mid-Trend Pullbacks: clean stage-2 uptrend pausing constructively
    query<TechScanRow>(
      `with latest_td as (
         select distinct on (asset_id) asset_id, date, close, sma_20, rsi_14, atr_pct_14,
                volume_ratio_20, return_5d, return_20d, distance_sma_20_pct,
                distance_sma_50_pct, distance_sma_200_pct, ibs_close
         from public.screener_technical_daily
         where date >= current_date - interval '10 days'
         order by asset_id, date desc
       )
       select td.asset_id, a.ticker, a.name, a.exchange, a.sector, td.date, td.close, td.sma_20,
              td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
              td.distance_sma_20_pct, td.distance_sma_50_pct, td.distance_sma_200_pct, td.ibs_close,
              q.price as live_price, q.change_pct as live_change_pct, f.market_cap
       from latest_td td
       join public.assets a on a.id = td.asset_id
       left join public.latest_quotes q on q.asset_id = td.asset_id
       left join public.screener_fundamental_latest f on f.asset_id = td.asset_id
       where a.country = $1
         and a.is_active = true
         and a.asset_class = 'STOCK'
         and td.close >= $2
         and td.distance_sma_20_pct between 0.2 and 8.5
         and td.distance_sma_50_pct > 1.0
         and td.distance_sma_200_pct > 2.0
         and td.rsi_14 between 50 and 68
         and td.return_20d >= 6
         and coalesce(td.atr_pct_14, 3) <= 6.5
         and coalesce(td.volume_ratio_20, 0) >= 0.75
         and (f.market_cap is null or f.market_cap >= $3)
       order by td.return_20d desc, coalesce(td.volume_ratio_20, 0) desc
       limit 60`,
      [country, priceFloor, mcapFloor],
    ).catch(() => []),

    // Oversold Snapbacks: RSI <= 42 holding near 200DMA with stabilization
    query<TechScanRow>(
      `with latest_td as (
         select distinct on (asset_id) asset_id, date, close, sma_20, rsi_14, atr_pct_14,
                volume_ratio_20, return_5d, return_20d, distance_sma_20_pct,
                distance_sma_50_pct, distance_sma_200_pct, ibs_close
         from public.screener_technical_daily
         where date >= current_date - interval '10 days'
         order by asset_id, date desc
       )
       select td.asset_id, a.ticker, a.name, a.exchange, a.sector, td.date, td.close, td.sma_20,
              td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
              td.distance_sma_20_pct, td.distance_sma_50_pct, td.distance_sma_200_pct, td.ibs_close,
              q.price as live_price, q.change_pct as live_change_pct, f.market_cap
       from latest_td td
       join public.assets a on a.id = td.asset_id
       left join public.latest_quotes q on q.asset_id = td.asset_id
       left join public.screener_fundamental_latest f on f.asset_id = td.asset_id
       where a.country = $1
         and a.is_active = true
         and a.asset_class = 'STOCK'
         and td.close >= $2
         and td.rsi_14 between 22 and 42
         and td.distance_sma_200_pct between -10 and 20
         and (td.return_5d <= -3 or td.distance_sma_20_pct <= -3)
         and (coalesce(td.volume_ratio_20, 0) >= 0.65 or coalesce(q.change_pct, 0) >= 0.5 or coalesce(td.ibs_close, 0) >= 0.5)
         and coalesce(td.atr_pct_14, 3) <= 7.5
         and (f.market_cap is null or f.market_cap >= $3)
       order by (case when coalesce(q.change_pct, 0) > 0 then 1 else 0 end) desc,
                coalesce(td.volume_ratio_20, 0) desc,
                td.rsi_14 asc
       limit 60`,
      [country, priceFloor, mcapFloor],
    ).catch(() => []),
  ]);

  const filterOutNews = new Set<string>();
  const newsNoteByAsset = new Map<string, string>();
  for (const row of adverseNewsRows) {
    if (row.verdict === "FILTER_OUT") {
      filterOutNews.add(row.asset_id);
    } else if (row.catalyst_note || row.summary) {
      newsNoteByAsset.set(row.asset_id, row.catalyst_note || row.summary || "");
    }
  }
  const blackoutAssets = new Set(resultsBlackoutRows.map((r) => r.asset_id));

  const isExcluded = (assetId: string) => filterOutNews.has(assetId) || blackoutAssets.has(assetId);

  // Market context
  const breadth = breadthRows[0];
  const advancers = Number(breadth?.advancers ?? 0);
  const decliners = Number(breadth?.decliners ?? 0);
  const bench = benchRows[0];
  const benchDist50 = toNum(bench?.distance_sma_50_pct);
  const benchmarkAboveSma50 = benchDist50 === null ? null : benchDist50 >= 0;
  const benchmarkChangePct = toNum(bench?.change_pct);
  const regimeInfo = classifyMarketRegime({
    benchmarkAboveSma50,
    benchmarkChangePct,
    advancers,
    decliners,
  });

  const context: TacticalMarketContext = {
    ...regimeInfo,
    benchmarkTicker: bench?.ticker ?? MARKETS[market].benchmarks[0]?.ticker ?? (market === "IN" ? "NIFTY" : "SPY"),
    benchmarkPrice: toNum(bench?.price),
    benchmarkChangePct,
    benchmarkAboveSma50,
    advancers,
    decliners,
    asOfDate: toIsoDate(breadth?.latest_as_of),
  };

  // ---- Bucket 1: NEAR_TRIGGER (cross-engine confluence, deduplicated by ticker) ----
  interface NearAccum {
    assetId: string;
    ticker: string;
    name: string;
    exchange: string;
    sector: string | null;
    baseScore: number;
    engines: Set<string>;
    reasons: string[];
    price: number;
    changePct: number | null;
    entry: number | null;
    stop: number | null;
    target: number | null;
    rsi14: number | null;
    atrPct: number | null;
    volumeRatio: number | null;
    return5d: number | null;
    return20d: number | null;
    distanceSma20Pct: number | null;
    distanceSma200Pct: number | null;
    asOfDate: string | null;
  }

  const nearByTicker = new Map<string, NearAccum>();

  const upsertNear = (
    ticker: string,
    exchange: string | null,
    init: Omit<NearAccum, "engines" | "reasons">,
    engineLabel: string,
    reasonPart: string,
  ) => {
    const existing = nearByTicker.get(ticker);
    if (!existing) {
      nearByTicker.set(ticker, {
        ...init,
        exchange: exchange ?? "",
        engines: new Set([engineLabel]),
        reasons: [reasonPart],
      });
      return;
    }
    // Prefer NSE/primary exchange metadata when dual-listed
    if (exchangeRank(exchange) > exchangeRank(existing.exchange)) {
      existing.assetId = init.assetId;
      existing.exchange = exchange ?? existing.exchange;
      existing.price = init.price;
      existing.changePct = init.changePct ?? existing.changePct;
    }
    existing.baseScore = Math.max(existing.baseScore, init.baseScore);
    if (!existing.engines.has(engineLabel)) {
      existing.engines.add(engineLabel);
      existing.reasons.push(reasonPart);
    }
    if (existing.entry === null && init.entry !== null) existing.entry = init.entry;
    if (existing.stop === null && init.stop !== null) existing.stop = init.stop;
    if (existing.target === null && init.target !== null) existing.target = init.target;
  };

  for (const row of strongRows) {
    if (isExcluded(row.asset_id)) continue;
    const check = evaluateStrongSwingNearTrigger(row.gates);
    if (!check.eligible) continue;
    const price = toNum(row.live_price) ?? toNum(row.current_price);
    if (!price || price < priceFloor) continue;
    const timingList = [...check.failedTimingGates, ...check.failedOtherGates].slice(0, 2);
    const reasonPart =
      timingList.length === 0
        ? `Strong Swing (${Math.round(Number(row.strength_score))}) ready`
        : `Strong Swing (${Math.round(Number(row.strength_score))}) · awaiting ${timingList.join(", ").replaceAll("_", " ")}`;
    upsertNear(
      row.ticker,
      row.exchange,
      {
        assetId: row.asset_id,
        ticker: row.ticker,
        name: row.name ?? row.ticker,
        exchange: row.exchange ?? "",
        sector: row.sector,
        baseScore: Number(row.strength_score),
        price,
        changePct: toNum(row.live_change_pct),
        entry: toNum(row.confirmation_entry),
        stop: toNum(row.projected_stop),
        target: toNum(row.projected_target),
        rsi14: toNum(row.rsi_14),
        atrPct: toNum(row.atr_pct_14),
        volumeRatio: toNum(row.volume_ratio_20),
        return5d: toNum(row.return_5d),
        return20d: toNum(row.return_20d),
        distanceSma20Pct: toNum(row.distance_sma_20_pct),
        distanceSma200Pct: toNum(row.distance_sma_200_pct),
        asOfDate: toIsoDate(row.latest_bar_date),
      },
      "Strong Swing",
      reasonPart,
    );
  }

  for (const row of trendRows) {
    if (isExcluded(row.asset_id)) continue;
    const price = toNum(row.live_price) ?? toNum(row.entry);
    if (!price || price < priceFloor) continue;
    const label = row.setup_variant ? `Mid-Way (${row.setup_variant.replaceAll("_", " ")})` : `Continuation (${row.status.replaceAll("_", " ")})`;
    upsertNear(
      row.ticker,
      row.exchange,
      {
        assetId: row.asset_id,
        ticker: row.ticker,
        name: row.name ?? row.ticker,
        exchange: row.exchange ?? "",
        sector: row.sector,
        baseScore: Math.min(96, Number(row.score)),
        price,
        changePct: toNum(row.live_change_pct),
        entry: toNum(row.entry),
        stop: toNum(row.stop),
        target: toNum(row.target),
        rsi14: toNum(row.rsi_14),
        atrPct: toNum(row.atr_pct_14),
        volumeRatio: toNum(row.volume_ratio_20),
        return5d: toNum(row.return_5d),
        return20d: toNum(row.return_20d),
        distanceSma20Pct: toNum(row.distance_sma_20_pct),
        distanceSma200Pct: toNum(row.distance_sma_200_pct),
        asOfDate: toIsoDate(row.asof_market_date),
      },
      "Trend Continuation",
      label,
    );
  }

  for (const row of obsRows) {
    if (isExcluded(row.asset_id)) continue;
    const price = toNum(row.live_price) ?? toNum(row.close);
    if (!price || price < priceFloor) continue;
    const engName =
      row.engine === "TREND_CONTINUATION"
        ? "Trend Continuation"
        : row.engine === "MOMENTUM_IGNITION_V2"
          ? "Momentum V2"
          : "Momentum";
    upsertNear(
      row.ticker,
      row.exchange,
      {
        assetId: row.asset_id,
        ticker: row.ticker,
        name: row.name ?? row.ticker,
        exchange: row.exchange ?? "",
        sector: row.sector,
        baseScore: row.status === "PRE_IGNITION" || row.status === "IMPULSE_DETECTED" ? 84 : 78,
        price,
        changePct: toNum(row.live_change_pct),
        entry: null,
        stop: null,
        target: null,
        rsi14: toNum(row.rsi_14),
        atrPct: toNum(row.atr_pct_14),
        volumeRatio: toNum(row.volume_ratio_20),
        return5d: toNum(row.return_5d),
        return20d: toNum(row.return_20d),
        distanceSma20Pct: toNum(row.distance_sma_20_pct),
        distanceSma200Pct: toNum(row.distance_sma_200_pct),
        asOfDate: toIsoDate(row.tech_date ?? row.observed_at),
      },
      engName,
      `${engName} (${row.status.replaceAll("_", " ")})`,
    );
  }

  for (const row of swingRows) {
    if (isExcluded(row.asset_id)) continue;
    const price = toNum(row.live_price) ?? toNum(row.last_close);
    if (!price || price < priceFloor) continue;
    const score100 = Math.round(Math.min(1, Number(row.score)) * 100);
    upsertNear(
      row.ticker,
      row.exchange,
      {
        assetId: row.asset_id,
        ticker: row.ticker,
        name: row.name ?? row.ticker,
        exchange: row.exchange ?? "",
        sector: row.sector,
        baseScore: Math.max(70, Math.min(90, score100)),
        price,
        changePct: toNum(row.live_change_pct),
        entry: null,
        stop: null,
        target: null,
        rsi14: toNum(row.rsi_14),
        atrPct: toNum(row.atr_pct_14),
        volumeRatio: toNum(row.volume_ratio_20),
        return5d: toNum(row.return_5d),
        return20d: toNum(row.return_20d),
        distanceSma20Pct: toNum(row.distance_sma_20_pct),
        distanceSma200Pct: toNum(row.distance_sma_200_pct),
        asOfDate: toIsoDate(row.as_of),
      },
      "Swing Breakout",
      `Swing Breakout (${score100}/100)`,
    );
  }

  const nearTrigger: TacticalCandidate[] = Array.from(nearByTicker.values())
    .map((item) => {
      const confluenceCount = item.engines.size;
      const finalScore = Math.min(100, Math.round(item.baseScore + (confluenceCount - 1) * 10));
      const fallback = computeAtrLevels(item.price, item.atrPct, "TREND");
      const referenceEntry = item.entry && item.entry > 0 ? round2(item.entry) : fallback.referenceEntry;
      const invalidationStop =
        item.stop && item.stop > 0 && item.stop < referenceEntry ? round2(item.stop) : fallback.invalidationStop;
      const targetZone =
        item.target && item.target > referenceEntry ? round2(item.target) : fallback.targetZone;
      const riskPct = round2(((referenceEntry - invalidationStop) / referenceEntry) * 100);
      return {
        assetId: item.assetId,
        ticker: item.ticker,
        name: item.name,
        exchange: item.exchange,
        sector: item.sector,
        bucket: "NEAR_TRIGGER" as const,
        riskTier: "MODERATE" as const,
        score: finalScore,
        price: round2(item.price),
        changePct: item.changePct !== null ? round2(item.changePct) : null,
        referenceEntry,
        invalidationStop,
        targetZone,
        riskPct,
        rsi14: item.rsi14 !== null ? round2(item.rsi14) : null,
        atrPct: item.atrPct !== null ? round2(item.atrPct) : null,
        volumeRatio: item.volumeRatio !== null ? round2(item.volumeRatio) : null,
        return5d: item.return5d !== null ? round2(item.return5d) : null,
        return20d: item.return20d !== null ? round2(item.return20d) : null,
        distanceSma20Pct: item.distanceSma20Pct !== null ? round2(item.distanceSma20Pct) : null,
        distanceSma200Pct: item.distanceSma200Pct !== null ? round2(item.distanceSma200Pct) : null,
        engines: Array.from(item.engines),
        confluenceCount,
        reason: item.reasons.slice(0, 2).join(" + "),
        newsNote: newsNoteByAsset.get(item.assetId) ?? null,
        asOfDate: item.asOfDate,
      };
    })
    .sort((a, b) => b.confluenceCount - a.confluenceCount || b.score - a.score || (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0))
    .slice(0, limitPerBucket);

  const usedTickers = new Set(nearTrigger.map((c) => c.ticker));

  // ---- Bucket 2: MID_TREND_PULLBACK ----
  const pullbackByTicker = new Map<string, TechScanRow>();
  for (const row of pullbackRows) {
    if (isExcluded(row.asset_id) || usedTickers.has(row.ticker)) continue;
    const prev = pullbackByTicker.get(row.ticker);
    if (!prev || exchangeRank(row.exchange) > exchangeRank(prev.exchange)) {
      pullbackByTicker.set(row.ticker, row);
    }
  }

  const midTrendPullback: TacticalCandidate[] = Array.from(pullbackByTicker.values())
    .map((row) => {
      const price = toNum(row.live_price) ?? Number(row.close);
      const atrPct = toNum(row.atr_pct_14);
      const rsi14 = toNum(row.rsi_14);
      const ret20 = toNum(row.return_20d) ?? 0;
      const vRatio = toNum(row.volume_ratio_20) ?? 1;
      const dist20 = toNum(row.distance_sma_20_pct) ?? 0;
      const dist200 = toNum(row.distance_sma_200_pct);
      const levels = computeAtrLevels(price, atrPct, "TREND");
      const score = Math.min(
        95,
        Math.round(62 + Math.min(18, ret20 * 0.8) + Math.min(10, Math.max(0, (vRatio - 0.8) * 8)) + (dist20 <= 4 ? 5 : 0)),
      );
      return {
        assetId: row.asset_id,
        ticker: row.ticker,
        name: row.name ?? row.ticker,
        exchange: row.exchange ?? "",
        sector: row.sector,
        bucket: "MID_TREND_PULLBACK" as const,
        riskTier: "MODERATE" as const,
        score,
        price: round2(price),
        changePct: toNum(row.live_change_pct) !== null ? round2(toNum(row.live_change_pct)!) : null,
        ...levels,
        rsi14: rsi14 !== null ? round2(rsi14) : null,
        atrPct: atrPct !== null ? round2(atrPct) : null,
        volumeRatio: round2(vRatio),
        return5d: toNum(row.return_5d) !== null ? round2(toNum(row.return_5d)!) : null,
        return20d: round2(ret20),
        distanceSma20Pct: round2(dist20),
        distanceSma200Pct: dist200 !== null ? round2(dist200) : null,
        engines: ["Stage-2 Pullback"],
        confluenceCount: 1,
        reason: `Above SMA20/50/200 · 20D +${ret20.toFixed(1)}% · RSI ${rsi14?.toFixed(0) ?? "--"} · ${dist20.toFixed(1)}% above SMA20`,
        newsNote: newsNoteByAsset.get(row.asset_id) ?? null,
        asOfDate: toIsoDate(row.date),
      };
    })
    .sort((a, b) => b.score - a.score || (b.return20d ?? 0) - (a.return20d ?? 0))
    .slice(0, limitPerBucket);

  for (const c of midTrendPullback) usedTickers.add(c.ticker);

  // ---- Bucket 3: OVERSOLD_SNAPBACK ----
  const snapbackByTicker = new Map<string, TechScanRow>();
  for (const row of snapbackRows) {
    if (isExcluded(row.asset_id) || usedTickers.has(row.ticker)) continue;
    const prev = snapbackByTicker.get(row.ticker);
    if (!prev || exchangeRank(row.exchange) > exchangeRank(prev.exchange)) {
      snapbackByTicker.set(row.ticker, row);
    }
  }

  const oversoldSnapback: TacticalCandidate[] = Array.from(snapbackByTicker.values())
    .map((row) => {
      const price = toNum(row.live_price) ?? Number(row.close);
      const atrPct = toNum(row.atr_pct_14);
      const rsi14 = toNum(row.rsi_14) ?? 38;
      const vRatio = toNum(row.volume_ratio_20) ?? 1;
      const chg = toNum(row.live_change_pct);
      const dist200 = toNum(row.distance_sma_200_pct);
      const sma20 = toNum(row.sma_20);
      const levels = computeAtrLevels(price, atrPct, "SNAPBACK", sma20);
      const score = Math.min(
        92,
        Math.round(
          58 +
            Math.max(0, (42 - rsi14) * 1.1) +
            Math.min(12, Math.max(0, (vRatio - 0.7) * 8)) +
            (chg !== null && chg > 0 ? 8 : 0) +
            (dist200 !== null && dist200 >= 0 ? 5 : 0),
        ),
      );
      return {
        assetId: row.asset_id,
        ticker: row.ticker,
        name: row.name ?? row.ticker,
        exchange: row.exchange ?? "",
        sector: row.sector,
        bucket: "OVERSOLD_SNAPBACK" as const,
        riskTier: "HIGHER_MEAN_REVERSION" as const,
        score,
        price: round2(price),
        changePct: chg !== null ? round2(chg) : null,
        ...levels,
        rsi14: round2(rsi14),
        atrPct: atrPct !== null ? round2(atrPct) : null,
        volumeRatio: round2(vRatio),
        return5d: toNum(row.return_5d) !== null ? round2(toNum(row.return_5d)!) : null,
        return20d: toNum(row.return_20d) !== null ? round2(toNum(row.return_20d)!) : null,
        distanceSma20Pct: toNum(row.distance_sma_20_pct) !== null ? round2(toNum(row.distance_sma_20_pct)!) : null,
        distanceSma200Pct: dist200 !== null ? round2(dist200) : null,
        engines: ["Oversold Snapback"],
        confluenceCount: 1,
        reason: `Mean reversion · RSI ${rsi14.toFixed(0)} · ${dist200 !== null ? `${dist200 >= 0 ? "+" : ""}${dist200.toFixed(1)}% vs 200DMA` : "near base"} · vol ${vRatio.toFixed(1)}x`,
        newsNote: newsNoteByAsset.get(row.asset_id) ?? null,
        asOfDate: toIsoDate(row.date),
      };
    })
    .sort((a, b) => b.score - a.score || (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0))
    .slice(0, limitPerBucket);

  return {
    market,
    generatedAt: new Date().toISOString(),
    context,
    buckets: {
      NEAR_TRIGGER: nearTrigger,
      MID_TREND_PULLBACK: midTrendPullback,
      OVERSOLD_SNAPBACK: oversoldSnapback,
    },
    excludedCounts: {
      adverseNews: filterOutNews.size,
      resultsBlackout: blackoutAssets.size,
    },
  };
}
