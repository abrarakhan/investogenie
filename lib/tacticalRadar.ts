import { query, tenantQuery } from "@/lib/db";
import { MARKETS, MARKET_COUNTRY } from "@/lib/markets";
import {
  isMarketOpenNow,
  latestSignalSessionDate,
  zonedMarketClock,
} from "@/lib/market-calendar.mjs";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { MarketId } from "@/lib/types";
import {
  TACTICAL_BUCKET_META,
  type TacticalBucketKey,
  type TacticalCandidate,
  type TacticalMarketContext,
  type TacticalMarketRegime,
  type TacticalRadarResult,
  type TacticalRiskTier,
} from "@/lib/tacticalRadarTypes";

export {
  TACTICAL_BUCKET_META,
  type TacticalBucketKey,
  type TacticalCandidate,
  type TacticalMarketContext,
  type TacticalMarketRegime,
  type TacticalRadarResult,
  type TacticalRiskTier,
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Preserve local calendar date so PostgreSQL DATE values decoded at local midnight
    // (e.g. 00:00+05:30 on an IST host) never shift back one day via UTC toISOString().
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function tacticalQuoteSessionCutoff(market: MarketId, at: Date = new Date()): {
  expectedSession: string;
  requiredQuoteDate: string;
  timeZone: string;
  marketOpen: boolean;
} {
  const clock = zonedMarketClock(market, at);
  const marketOpen = isMarketOpenNow(market, at);
  const expectedSession = latestSignalSessionDate(market, at);
  const requiredQuoteDate = marketOpen ? clock.date : expectedSession;
  return {
    expectedSession,
    requiredQuoteDate,
    timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York",
    marketOpen,
  };
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
  traded_value: string | number | null;
}

interface ExclusionRow {
  asset_id: string;
  verdict?: string;
  summary?: string | null;
  catalyst_note?: string | null;
}

export interface PythonTacticalRadarInput {
  market: MarketId;
  priceFloor: number;
  limitPerBucket: number;
  breadth: {
    advancers: number;
    decliners: number;
    asOfDate: string | null;
  };
  benchmark: {
    ticker: string;
    price: number | null;
    changePct: number | null;
    aboveSma50: boolean | null;
  };
  excludedAssetIds: string[];
  excludedCounts: {
    adverseNews: number;
    resultsBlackout: number;
  };
  newsNotes: Record<string, string>;
  strongRows: Array<Record<string, unknown>>;
  obsRows: Array<Record<string, unknown>>;
  trendRows: Array<Record<string, unknown>>;
  swingRows: Array<Record<string, unknown>>;
  pullbackRows: Array<Record<string, unknown>>;
  snapbackRows: Array<Record<string, unknown>>;
}

interface PythonTacticalRadarOutput {
  context: TacticalMarketContext;
  buckets: Record<TacticalBucketKey, TacticalCandidate[]>;
  excludedCounts: {
    adverseNews: number;
    resultsBlackout: number;
  };
}

/** Execute the authoritative Python Tactical Radar engine on prepared inputs. */
export async function computeTacticalRadarInPython(
  input: PythonTacticalRadarInput,
): Promise<TacticalRadarResult> {
  const [computed] = await runPythonStrategyBatch<PythonTacticalRadarInput, PythonTacticalRadarOutput>(
    "tactical_radar",
    [input],
  );
  if (!computed) {
    throw new Error("Python tactical_radar engine returned an empty result");
  }
  return {
    market: input.market,
    generatedAt: new Date().toISOString(),
    context: computed.context,
    buckets: computed.buckets,
    excludedCounts: computed.excludedCounts,
  };
}

const RADAR_CACHE_TTL_MS = 60_000;
const radarCache = new Map<string, { at: number; data: TacticalRadarResult }>();

export function clearTacticalRadarCache(): void {
  radarCache.clear();
}

export async function getTacticalRadar(
  market: MarketId,
  userId: string,
  limitPerBucket = 15,
  at: Date = new Date(),
): Promise<TacticalRadarResult> {
  if (!userId) {
    throw new Error("getTacticalRadar requires an authenticated userId for tenant isolation");
  }
  const cacheKey = `${userId}:${market}:${limitPerBucket}`;
  const cached = radarCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RADAR_CACHE_TTL_MS) {
    return cached.data;
  }

  const country = MARKET_COUNTRY[market];
  const priceFloor = market === "IN" ? 20 : 2;
  const tradedValueFloor = market === "IN" ? 10_000_000 : 1_000_000;
  const benchmarkTickers = market === "IN" ? ["NIFTY", "NIFTYBEES"] : ["SPY"];
  const { expectedSession, requiredQuoteDate } = tacticalQuoteSessionCutoff(market, at);

  const logQueryErr = (label: string) => (err: unknown) => {
    console.error(`[tactical-radar] ${label} query failed:`, err instanceof Error ? err.message : err);
    return [];
  };

  // Latest precomputed technical date up to the expected trading session (cast to ::text to avoid JS Date TZ shift)
  const latestTdDateRows = await query<{ max_date: string | Date | null }>(
    `select max(td.date)::text as max_date
     from public.screener_technical_daily td
     join public.assets a on a.id = td.asset_id
     where a.country = $1
       and td.date <= $2::date
       and td.date >= ($2::date - interval '10 days')`,
    [country, expectedSession],
  ).catch(logQueryErr("latestTdDate"));
  const latestTdDate = toIsoDate(latestTdDateRows[0]?.max_date);

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
    // Session-aligned breadth: latest_quotes.as_of is a PostgreSQL DATE — compare directly without AT TIME ZONE
    query<BreadthRow>(
      `select
         count(*) filter (where q.change_pct > 0) as advancers,
         count(*) filter (where q.change_pct < 0) as decliners,
         max(q.as_of)::text as latest_as_of
       from public.assets a
       join public.latest_quotes q on q.asset_id = a.id
       where a.country = $1
         and a.is_active = true
         and a.asset_class = 'STOCK'
         and q.as_of >= $2::date`,
      [country, requiredQuoteDate],
    ).catch(logQueryErr("breadth")),

    // Session-aligned benchmark requiring 50 valid completed bars whose newest bar matches
    // expectedSession. Falls back to the next benchmark (e.g. NIFTY -> NIFTYBEES) when the
    // primary lacks fresh 50-bar history; returns null distance_sma_50_pct (UNVERIFIED) if none qualify.
    query<BenchRow>(
      `select a.ticker, q.price, q.change_pct,
              case
                when b50.bar_count = 50 and b50.latest_bar_date = $3 and b50.sma50 > 0
                then ((q.price - b50.sma50) / b50.sma50) * 100
                else null
              end as distance_sma_50_pct
       from public.assets a
       join public.latest_quotes q on q.asset_id = a.id
       left join lateral (
         select count(*) as bar_count,
                max(sub.date)::text as latest_bar_date,
                avg(sub.close) as sma50
         from (
           select date, close
           from public.daily_ohlcv
           where asset_id = a.id
             and date <= $3::date
             and close is not null
             and close > 0
           order by date desc
           limit 50
         ) sub
       ) b50 on true
       where a.country = $1
         and a.ticker = any($2)
         and q.as_of >= $4::date
       order by
         case when b50.bar_count = 50 and b50.latest_bar_date = $3 and b50.sma50 > 0 then 0 else 1 end asc,
         array_position($2::text[], a.ticker) asc
       limit 1`,
      [country, benchmarkTickers, expectedSession, requiredQuoteDate],
    ).catch(logQueryErr("benchmark")),

    query<ExclusionRow>(
      `select asset_id, verdict, summary, catalyst_note
       from public.news_stock_briefs
       where market = $1 and generated_at >= now() - interval '72 hours'`,
      [market],
    ).catch(logQueryErr("newsBriefs")),

    query<{ asset_id: string }>(
      `select distinct asset_id
       from public.corporate_events
       where event_type = 'RESULTS'
         and event_date between ($1::date - interval '1 day') and ($1::date + interval '3 days')`,
      [expectedSession],
    ).catch(logQueryErr("resultsBlackout")),

    query<StrongSnapRow>(
      `with latest_ts as (
         select max(captured_at) as ts
         from public.strong_swing_snapshots
         where market = $1
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
       left join public.screener_technical_daily td
         on td.asset_id = s.asset_id and td.date = $2::date
       where s.market = $1
         and s.status <> 'INVALIDATED'
         and s.strength_score >= 82
       order by s.strength_score desc, s.rank asc
       limit 80`,
      [market, latestTdDate],
    ).catch(logQueryErr("strongSwing")),

    // Tenant-scoped observations: select the latest row per (asset_id, engine) FIRST,
    // then filter qualifying statuses so a newer invalidation/extended row suppresses older watches.
    tenantQuery<ObservationRow>(
      userId,
      `with latest_obs as (
         select distinct on (o.asset_id, o.engine)
                o.asset_id, o.engine, o.status, o.observed_at
         from public.candidate_signal_observations o
         where o.user_id = $1
           and o.market = $2
           and o.observed_at >= now() - interval '72 hours'
           and o.engine in ('MOMENTUM_IGNITION', 'MOMENTUM_IGNITION_V2', 'TREND_CONTINUATION')
         order by o.asset_id, o.engine, o.observed_at desc
       )
       select o.asset_id, a.ticker, a.name, a.exchange, a.sector,
              o.engine, o.status, o.observed_at,
              q.price as live_price, q.change_pct as live_change_pct,
              td.close, td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
              td.distance_sma_20_pct, td.distance_sma_200_pct, td.date as tech_date
       from latest_obs o
       join public.assets a on a.id = o.asset_id
       left join public.latest_quotes q on q.asset_id = o.asset_id
       left join public.screener_technical_daily td
         on td.asset_id = o.asset_id and td.date = $3::date
       where o.status in (
         'EARLY_WATCH', 'PRE_IGNITION', 'FIRST_THRUST', 'RETEST_SETUP',
         'IMPULSE_DETECTED', 'CONTINUATION_WATCH', 'TREND_CONTINUATION_READY'
       )
       limit 120`,
      [userId, market, latestTdDate],
    ).catch(logQueryErr("observations")),

    // Select latest trend_continuation row per asset FIRST, then filter qualifying statuses.
    market === "IN"
      ? query<TrendRow>(
          `with latest_trend as (
             select distinct on (t.asset_id)
                    t.asset_id, t.status, t.score, t.entry, t.stop, t.target,
                    t.asof_market_date, t.setup_variant
             from public.trend_continuation_signals t
             where t.market = 'IN'
               and t.asof_market_date >= ($2::date - interval '5 days')
             order by t.asset_id, t.asof_market_date desc, t.computed_at desc
           )
           select t.asset_id, a.ticker, a.name, a.exchange, a.sector,
                  t.status, t.score, t.entry, t.stop, t.target, t.asof_market_date, t.setup_variant,
                  q.price as live_price, q.change_pct as live_change_pct,
                  td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
                  td.distance_sma_20_pct, td.distance_sma_200_pct
           from latest_trend t
           join public.assets a on a.id = t.asset_id
           left join public.latest_quotes q on q.asset_id = t.asset_id
           left join public.screener_technical_daily td
             on td.asset_id = t.asset_id and td.date = $1::date
           where t.status in ('TREND_CONTINUATION_READY', 'IMPULSE_DETECTED', 'CONTINUATION_WATCH')
             and t.score >= 65
           order by t.score desc
           limit 60`,
          [latestTdDate, expectedSession],
        ).catch(logQueryErr("trendContinuation"))
      : Promise.resolve([]),

    query<SwingBreakoutRow>(
      `with latest_asof as (
         select max(as_of) as dt from public.swing_signals where country = $1
       )
       select s.asset_id, a.ticker, a.name, a.exchange, a.sector, s.score, s.last_close, s.as_of,
              q.price as live_price, q.change_pct as live_change_pct,
              td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
              td.distance_sma_20_pct, td.distance_sma_200_pct
       from public.swing_signals s
       join latest_asof la on s.as_of = la.dt
       join public.assets a on a.id = s.asset_id
       left join public.latest_quotes q on q.asset_id = s.asset_id
       left join public.screener_technical_daily td
         on td.asset_id = s.asset_id and td.date = $4::date
       left join public.daily_ohlcv o
         on o.asset_id = s.asset_id and o.date = $4::date
       where s.country = $1
         and s.verdict = 'LONG_BREAKOUT'
         and s.score >= 0.55
         and s.last_close >= $2
         and (o.volume is null or (o.close * o.volume) >= $3)
       order by s.score desc, coalesce(td.volume_ratio_20, 0) desc
       limit 60`,
      [country, priceFloor, tradedValueFloor, latestTdDate],
    ).catch(logQueryErr("swingBreakout")),

    latestTdDate
      ? query<TechScanRow>(
          `select td.asset_id, a.ticker, a.name, a.exchange, a.sector, td.date, td.close, td.sma_20,
                  td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
                  td.distance_sma_20_pct, td.distance_sma_50_pct, td.distance_sma_200_pct, td.ibs_close,
                  q.price as live_price, q.change_pct as live_change_pct,
                  coalesce(o.close * o.volume, 0) as traded_value
           from public.screener_technical_daily td
           join public.assets a on a.id = td.asset_id
           left join public.latest_quotes q on q.asset_id = td.asset_id
           left join public.daily_ohlcv o on o.asset_id = td.asset_id and o.date = td.date
           where td.date = $4::date
             and a.country = $1
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
             and coalesce(o.close * o.volume, 0) >= $3
           order by coalesce(td.volume_ratio_20, 0) desc, td.return_20d desc
           limit 100`,
          [country, priceFloor, tradedValueFloor, latestTdDate],
        ).catch(logQueryErr("pullback"))
      : Promise.resolve([]),

    latestTdDate
      ? query<TechScanRow>(
          `select td.asset_id, a.ticker, a.name, a.exchange, a.sector, td.date, td.close, td.sma_20,
                  td.rsi_14, td.atr_pct_14, td.volume_ratio_20, td.return_5d, td.return_20d,
                  td.distance_sma_20_pct, td.distance_sma_50_pct, td.distance_sma_200_pct, td.ibs_close,
                  q.price as live_price, q.change_pct as live_change_pct,
                  coalesce(o.close * o.volume, 0) as traded_value
           from public.screener_technical_daily td
           join public.assets a on a.id = td.asset_id
           left join public.latest_quotes q on q.asset_id = td.asset_id
           left join public.daily_ohlcv o on o.asset_id = td.asset_id and o.date = td.date
           where td.date = $4::date
             and a.country = $1
             and a.is_active = true
             and a.asset_class = 'STOCK'
             and td.close >= $2
             and td.rsi_14 between 22 and 42
             and td.distance_sma_200_pct between -10 and 20
             and (td.return_5d <= -3 or td.distance_sma_20_pct <= -3)
             and (coalesce(td.volume_ratio_20, 0) >= 0.65 or coalesce(q.change_pct, 0) >= 0.5 or coalesce(td.ibs_close, 0) >= 0.5)
             and coalesce(td.atr_pct_14, 3) <= 7.5
             and coalesce(o.close * o.volume, 0) >= $3
           order by (case when coalesce(q.change_pct, 0) > 0 then 1 else 0 end) desc,
                    coalesce(td.volume_ratio_20, 0) desc,
                    td.rsi_14 asc
           limit 100`,
          [country, priceFloor, tradedValueFloor, latestTdDate],
        ).catch(logQueryErr("snapback"))
      : Promise.resolve([]),
  ]);

  const filterOutNews = new Set<string>();
  const newsNotes: Record<string, string> = {};
  for (const row of adverseNewsRows) {
    if (row.verdict === "FILTER_OUT") {
      filterOutNews.add(row.asset_id);
    } else if (row.catalyst_note || row.summary) {
      newsNotes[row.asset_id] = row.catalyst_note || row.summary || "";
    }
  }
  const blackoutAssets = new Set(resultsBlackoutRows.map((r) => r.asset_id));
  const excludedAssetIds = Array.from(new Set([...filterOutNews, ...blackoutAssets]));

  const breadth = breadthRows[0];
  const bench = benchRows[0];
  const benchDist50 = toNum(bench?.distance_sma_50_pct);

  const pythonInput: PythonTacticalRadarInput = {
    market,
    priceFloor,
    limitPerBucket,
    breadth: {
      advancers: Number(breadth?.advancers ?? 0),
      decliners: Number(breadth?.decliners ?? 0),
      asOfDate: toIsoDate(breadth?.latest_as_of),
    },
    benchmark: {
      ticker: bench?.ticker ?? MARKETS[market].benchmarks[0]?.ticker ?? (market === "IN" ? "NIFTY" : "SPY"),
      price: toNum(bench?.price),
      changePct: toNum(bench?.change_pct),
      aboveSma50: benchDist50 === null ? null : benchDist50 >= 0,
    },
    excludedAssetIds,
    excludedCounts: {
      adverseNews: filterOutNews.size,
      resultsBlackout: blackoutAssets.size,
    },
    newsNotes,
    strongRows: strongRows.map((r) => ({
      assetId: r.asset_id,
      ticker: r.ticker,
      name: r.name,
      exchange: r.exchange,
      sector: r.sector,
      strengthScore: toNum(r.strength_score),
      currentPrice: toNum(r.current_price),
      confirmationEntry: toNum(r.confirmation_entry),
      projectedTarget: toNum(r.projected_target),
      projectedStop: toNum(r.projected_stop),
      gates: r.gates,
      asOfDate: toIsoDate(r.latest_bar_date),
      livePrice: toNum(r.live_price),
      liveChangePct: toNum(r.live_change_pct),
      rsi14: toNum(r.rsi_14),
      atrPct: toNum(r.atr_pct_14),
      volumeRatio: toNum(r.volume_ratio_20),
      return5d: toNum(r.return_5d),
      return20d: toNum(r.return_20d),
      distanceSma20Pct: toNum(r.distance_sma_20_pct),
      distanceSma200Pct: toNum(r.distance_sma_200_pct),
    })),
    obsRows: obsRows.map((r) => ({
      assetId: r.asset_id,
      ticker: r.ticker,
      name: r.name,
      exchange: r.exchange,
      sector: r.sector,
      engine: r.engine,
      status: r.status,
      asOfDate: toIsoDate(r.tech_date ?? r.observed_at),
      livePrice: toNum(r.live_price),
      liveChangePct: toNum(r.live_change_pct),
      close: toNum(r.close),
      rsi14: toNum(r.rsi_14),
      atrPct: toNum(r.atr_pct_14),
      volumeRatio: toNum(r.volume_ratio_20),
      return5d: toNum(r.return_5d),
      return20d: toNum(r.return_20d),
      distanceSma20Pct: toNum(r.distance_sma_20_pct),
      distanceSma200Pct: toNum(r.distance_sma_200_pct),
    })),
    trendRows: trendRows.map((r) => ({
      assetId: r.asset_id,
      ticker: r.ticker,
      name: r.name,
      exchange: r.exchange,
      sector: r.sector,
      status: r.status,
      score: toNum(r.score),
      entry: toNum(r.entry),
      stop: toNum(r.stop),
      target: toNum(r.target),
      setupVariant: r.setup_variant,
      asOfDate: toIsoDate(r.asof_market_date),
      livePrice: toNum(r.live_price),
      liveChangePct: toNum(r.live_change_pct),
      rsi14: toNum(r.rsi_14),
      atrPct: toNum(r.atr_pct_14),
      volumeRatio: toNum(r.volume_ratio_20),
      return5d: toNum(r.return_5d),
      return20d: toNum(r.return_20d),
      distanceSma20Pct: toNum(r.distance_sma_20_pct),
      distanceSma200Pct: toNum(r.distance_sma_200_pct),
    })),
    swingRows: swingRows.map((r) => ({
      assetId: r.asset_id,
      ticker: r.ticker,
      name: r.name,
      exchange: r.exchange,
      sector: r.sector,
      score: toNum(r.score),
      lastClose: toNum(r.last_close),
      asOfDate: toIsoDate(r.as_of),
      livePrice: toNum(r.live_price),
      liveChangePct: toNum(r.live_change_pct),
      rsi14: toNum(r.rsi_14),
      atrPct: toNum(r.atr_pct_14),
      volumeRatio: toNum(r.volume_ratio_20),
      return5d: toNum(r.return_5d),
      return20d: toNum(r.return_20d),
      distanceSma20Pct: toNum(r.distance_sma_20_pct),
      distanceSma200Pct: toNum(r.distance_sma_200_pct),
    })),
    pullbackRows: pullbackRows.map((r) => ({
      assetId: r.asset_id,
      ticker: r.ticker,
      name: r.name,
      exchange: r.exchange,
      sector: r.sector,
      asOfDate: toIsoDate(r.date),
      close: toNum(r.close),
      sma20: toNum(r.sma_20),
      livePrice: toNum(r.live_price),
      liveChangePct: toNum(r.live_change_pct),
      rsi14: toNum(r.rsi_14),
      atrPct: toNum(r.atr_pct_14),
      volumeRatio: toNum(r.volume_ratio_20),
      return5d: toNum(r.return_5d),
      return20d: toNum(r.return_20d),
      distanceSma20Pct: toNum(r.distance_sma_20_pct),
      distanceSma200Pct: toNum(r.distance_sma_200_pct),
      tradedValue: toNum(r.traded_value),
    })),
    snapbackRows: snapbackRows.map((r) => ({
      assetId: r.asset_id,
      ticker: r.ticker,
      name: r.name,
      exchange: r.exchange,
      sector: r.sector,
      asOfDate: toIsoDate(r.date),
      close: toNum(r.close),
      sma20: toNum(r.sma_20),
      livePrice: toNum(r.live_price),
      liveChangePct: toNum(r.live_change_pct),
      rsi14: toNum(r.rsi_14),
      atrPct: toNum(r.atr_pct_14),
      volumeRatio: toNum(r.volume_ratio_20),
      return5d: toNum(r.return_5d),
      return20d: toNum(r.return_20d),
      distanceSma20Pct: toNum(r.distance_sma_20_pct),
      distanceSma200Pct: toNum(r.distance_sma_200_pct),
    })),
  };

  const result = await computeTacticalRadarInPython(pythonInput);
  radarCache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}
