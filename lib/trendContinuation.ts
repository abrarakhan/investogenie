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
  computedAt: string; metrics: Record<string, number | boolean | number[] | string | null>; reasons: string[];
  executionEligible: boolean; executionBlockers: string[]; currentPrice: number | null;
}
interface Row {
  asset_id: string; ticker: string; name: string | null; status: TrendContinuationStatus;
  ready: boolean; observation_only: boolean; score: number; entry: string | null; stop: string | null;
  target: string | null; asof_market_date: string; computed_at: string;
  metrics: Record<string, number | boolean | number[] | string | null>; reasons: string[];
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
    `select status, count(distinct asset_id)::text total from public.trend_continuation_signals
      where market=$1
        and asof_market_date=(select max(asof_market_date) from public.trend_continuation_signals where market=$1)
      group by status`, [market]);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
}

const STATUS_ORDER: Record<TrendContinuationStatus, number> = {
  TREND_CONTINUATION_READY: 0, CONTINUATION_WATCH: 1, IMPULSE_DETECTED: 2, EXTENDED_RISK: 3,
};

/** Entries first, then second-day staircases, then by status and score; "too late" stocks last. */
export function compareTrendCandidates(
  a: Pick<TrendContinuationCandidate, "status" | "ready" | "score" | "metrics">,
  b: Pick<TrendContinuationCandidate, "status" | "ready" | "score" | "metrics">,
): number {
  return Number(b.ready) - Number(a.ready)
    || Number(b.metrics.developing_staircase === true) - Number(a.metrics.developing_staircase === true)
    || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || b.score - a.score;
}

export async function getTrendContinuationCandidates(market: "IN" | "US", limit = 40): Promise<TrendContinuationCandidate[]> {
  if (market !== "IN") return [];
  await refreshMarketHolidays(market).catch(() => false);
  const marketOpen = isMarketOpenNow(market);
  const sessionDate = zonedMarketClock(market).date;
  const rows = await query<Row>(`select distinct on (asset_id) asset_id,ticker,name,status,ready,observation_only,
      score,entry,stop,target,asof_market_date::text,computed_at::text,metrics,reasons
    from public.trend_continuation_signals where market=$1
      and asof_market_date=(select max(asof_market_date) from public.trend_continuation_signals where market=$1)
    order by asset_id,asof_market_date desc,computed_at desc`, [market]);
  const ids = rows.map((row) => row.asset_id);
  const executionRows = ids.length ? await query<ExecutionRow>(
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
  ) : [];
  const executionByAsset = new Map(executionRows.map((row) => [row.asset_id, row]));
  const now = new Date().toISOString();
  const inputs = rows.map((row) => ({
    candidate: row,
    execution: executionByAsset.get(row.asset_id) ?? null,
    now,
    sessionDate,
    marketOpen,
    holidays: marketHolidayDates(market),
    specialTradingDates: Object.keys(SPECIAL_SESSIONS.IN),
  }));
  const assessments = await runPythonStrategyBatch<(typeof inputs)[number], Pick<TrendContinuationCandidate,
    "executionEligible" | "executionBlockers" | "observationOnly" | "currentPrice"> & { pythonRank: number }>("trend_execution", inputs);
  return rows.map((row, index) => {
    const assessment = assessments[index];
    const entry = row.entry === null ? null : Number(row.entry);
    return {
      assetId: row.asset_id, ticker: row.ticker, name: row.name, status: row.status,
      ready: row.ready, observationOnly: assessment.observationOnly, score: row.score,
      entry, stop: row.stop === null ? null : Number(row.stop), target: row.target === null ? null : Number(row.target),
      asOfMarketDate: row.asof_market_date, computedAt: row.computed_at, metrics: row.metrics, reasons: row.reasons,
      executionEligible: assessment.executionEligible, executionBlockers: assessment.executionBlockers,
      currentPrice: assessment.currentPrice, pythonRank: assessment.pythonRank,
    };
  }).sort((left, right) => (left.pythonRank ?? Number.MAX_SAFE_INTEGER) - (right.pythonRank ?? Number.MAX_SAFE_INTEGER)).slice(0, limit);
}
