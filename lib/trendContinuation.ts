import { query } from "@/lib/db";
import { isMarketOpenNow, marketHolidayDates, refreshMarketHolidays, zonedMarketClock } from "@/lib/market-calendar.mjs";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import SPECIAL_SESSIONS from "@/config/market-special-sessions.json" with { type: "json" };

export type TrendContinuationStatus = "IMPULSE_DETECTED" | "CONTINUATION_WATCH" | "TREND_CONTINUATION_READY" | "EXTENDED_RISK";
export interface TrendContinuationCandidate {
  pythonRank?: number;
  assetId: string; ticker: string; name: string | null; status: TrendContinuationStatus;
  ready: boolean; observationOnly: boolean; score: number; entry: number | null;
  stop: number | null; target: number | null; asOfMarketDate: string;
  computedAt: string;
  /** Includes nested objects such as the frozen breakout levels. */
  metrics: Record<string, number | boolean | number[] | string | null | Record<string, unknown>>;
  reasons: string[];
  executionEligible: boolean; executionBlockers: string[]; currentPrice: number | null;
  /** Today's volume against the session curve's expectation at this minute. */
  todRvol: number | null;
  /** Version of the Python detector that produced this persisted signal. */
  featureVersion?: string;
}
interface Row {
  asset_id: string; ticker: string; name: string | null; status: TrendContinuationStatus;
  ready: boolean; observation_only: boolean; score: number; entry: string | null; stop: string | null;
  target: string | null; asof_market_date: string; computed_at: string;
  feature_version: string;
  metrics: Record<string, number | boolean | number[] | string | null | Record<string, unknown>>; reasons: string[];
}

interface ExecutionRow {
  asset_id: string; price: string | null; best_bid: string | null; best_ask: string | null;
  lower_circuit: string | null; upper_circuit: string | null; source: string | null; updated_at: string | null;
  next_date: string | null; last_past_date: string | null; last_success_at: string | null;
  authoritative_source: string | null; authoritative_as_of: string | null;
  authoritative_coverage_from: string | null; authoritative_coverage_through: string | null;
}

/** How many stocks the latest scan holds in each status, before the list is capped. */
export async function getTrendContinuationStatusTotals(market: "IN" | "US"): Promise<Record<string, number>> {
  if (market !== "IN") return {};
  const rows = await query<{ status: string; total: string }>(
    `select status, count(*)::text total from (
       select distinct on (asset_id) asset_id, status
         from public.trend_continuation_signals
        where market=$1
          and asof_market_date >= (select max(asof_market_date) - interval '4 days' from public.trend_continuation_signals where market=$1)
        order by asset_id, asof_market_date desc, computed_at desc
     ) latest
     group by status`, [market]);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
}

const STATUS_ORDER: Record<TrendContinuationStatus, number> = {
  TREND_CONTINUATION_READY: 0, CONTINUATION_WATCH: 1, IMPULSE_DETECTED: 2, EXTENDED_RISK: 3,
};

/**
 * Entries first, then second-day staircases, then by status and score; "too late" stocks
 * last. At an equal technical score an event-driven candidate ranks ahead of a purely
 * technical one: the same chart with a reason behind it is the better of the two.
 */
export function compareTrendCandidates(
  a: Pick<TrendContinuationCandidate, "status" | "ready" | "score" | "metrics">,
  b: Pick<TrendContinuationCandidate, "status" | "ready" | "score" | "metrics">,
): number {
  return Number(b.ready) - Number(a.ready)
    || Number(b.metrics.developing_staircase === true) - Number(a.metrics.developing_staircase === true)
    || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || b.score - a.score
    || Number(b.metrics.catalyst_tag === "EP") - Number(a.metrics.catalyst_tag === "EP");
}

export async function getTrendContinuationCandidates(market: "IN" | "US", limit = 40): Promise<TrendContinuationCandidate[]> {
  if (market !== "IN") return [];
  await refreshMarketHolidays(market).catch(() => false);
  const marketOpen = isMarketOpenNow(market);
  const clock = zonedMarketClock(market);
  const sessionDate = clock.date;
  const rows = await query<Row>(`select distinct on (asset_id) asset_id,ticker,name,status,ready,observation_only,
      score,entry,stop,target,asof_market_date::text,computed_at::text,feature_version,metrics,reasons
    from public.trend_continuation_signals where market=$1
      and asof_market_date >= (select max(asof_market_date) - interval '4 days' from public.trend_continuation_signals where market=$1)
    order by asset_id,asof_market_date desc,computed_at desc`, [market]);
  const ids = rows.map((row) => row.asset_id);
  const [executionRows, liveRows, baselineRows, curveRows] = ids.length ? await Promise.all([
    query<ExecutionRow>(
      `select a.id asset_id,q.price::text,q.best_bid::text,q.best_ask::text,q.lower_circuit::text,q.upper_circuit::text,
              q.source,q.updated_at::text,
              (select min(e.event_date)::text from public.corporate_events e where e.asset_id=a.id and e.event_type='RESULTS' and e.event_date >= $2::date) next_date,
              (select max(e.event_date)::text from public.corporate_events e where e.asset_id=a.id and e.event_type='RESULTS' and e.event_date < $2::date) last_past_date,
              s.last_success_at::text,s.authoritative_source,s.authoritative_as_of::text,
              s.authoritative_coverage_from::text,s.authoritative_coverage_through::text
         from unnest($1::uuid[]) a(id)
         left join public.latest_quotes q on q.asset_id=a.id
         left join public.corporate_event_sync_state s on s.asset_id=a.id`,
      [ids, sessionDate],
    ),
    marketOpen
      ? query<{ asset_id: string; volume: string | number | null }>(
        "select asset_id,volume from public.daily_ohlcv where asset_id=any($1::uuid[]) and date=$2::date",
        [ids, sessionDate],
      )
      : Promise.resolve([]),
    query<{ asset_id: string; average_volume_20: string | null }>(
      `select asset_id,avg(volume)::text average_volume_20 from (
         select o.asset_id,o.volume,row_number() over(partition by o.asset_id order by o.date desc) rn
           from public.daily_ohlcv o
          where o.asset_id=any($1::uuid[]) and not ($2::boolean and o.date >= $3::date)
       ) ranked where rn <= 20 group by asset_id`,
      [ids, marketOpen, sessionDate],
    ),
    query<{ version: string; sample_sessions: number; points: Array<[number, number]> }>(
      `select version,sample_sessions,points from public.market_volume_curves
        where market=$1 and active and sample_sessions >= 40
        order by generated_at desc limit 1`,
      [market],
    ).catch((error) => {
      if ((error as { code?: string }).code === "42P01") return [];
      throw error;
    }),
  ]) : [[], [], [], []];

  const executionByAsset = new Map(executionRows.map((row) => [row.asset_id, row]));
  const liveVolume = new Map(liveRows.map((row) => [row.asset_id, Number(row.volume ?? 0)]));
  const averageVolume = new Map(baselineRows.map((row) => [row.asset_id, Number(row.average_volume_20 ?? 0)]));
  const rawCurve = curveRows[0];
  const volumeCurve = rawCurve && Array.isArray(rawCurve.points)
    ? { market, version: rawCurve.version, sampleSessions: Number(rawCurve.sample_sessions), points: rawCurve.points }
    : null;
  const specialSession = (SPECIAL_SESSIONS.IN as Record<string, { openMinutes: number; closeMinutes: number }>)[sessionDate];
  const openMinutes = specialSession?.openMinutes ?? (9 * 60 + 15);
  const minutesElapsed = clock.minutes - openMinutes;

  const now = new Date().toISOString();
  const inputs = rows.map((row) => ({
    candidate: row,
    execution: executionByAsset.get(row.asset_id) ?? null,
    averageVolume20: averageVolume.get(row.asset_id) ?? null,
    liveSession: marketOpen
      ? { volume: liveVolume.get(row.asset_id) ?? 0, minutesElapsed }
      : null,
    breakoutLevels: (row.metrics?.breakout_levels as unknown as Record<string, unknown> | undefined) ?? null,
  }));
  const shared = {
    now,
    sessionDate,
    marketOpen,
    market,
    holidays: marketHolidayDates(market),
    specialTradingDates: Object.keys(SPECIAL_SESSIONS.IN),
    volumeCurve,
  };
  const assessments = await runPythonStrategyBatch<(typeof inputs)[number], Pick<TrendContinuationCandidate,
    "executionEligible" | "executionBlockers" | "observationOnly" | "currentPrice" | "todRvol">
    & { pythonRank: number; effectiveStatus: TrendContinuationStatus; effectiveReady: boolean }>("trend_execution", inputs, shared);
  return rows.map((row, index) => {
    const assessment = assessments[index];
    const entry = row.entry === null ? null : Number(row.entry);
    return {
      assetId: row.asset_id, ticker: row.ticker, name: row.name, status: assessment.effectiveStatus,
      ready: assessment.effectiveReady, observationOnly: assessment.observationOnly, score: row.score,
      entry, stop: row.stop === null ? null : Number(row.stop), target: row.target === null ? null : Number(row.target),
      asOfMarketDate: row.asof_market_date, computedAt: row.computed_at, metrics: row.metrics, reasons: row.reasons,
      executionEligible: assessment.executionEligible, executionBlockers: assessment.executionBlockers,
      currentPrice: assessment.currentPrice, todRvol: assessment.todRvol ?? null,
      featureVersion: row.feature_version,
      pythonRank: assessment.pythonRank,
    };
  }).sort((left, right) => (left.pythonRank ?? Number.MAX_SAFE_INTEGER) - (right.pythonRank ?? Number.MAX_SAFE_INTEGER)).slice(0, limit);
}
