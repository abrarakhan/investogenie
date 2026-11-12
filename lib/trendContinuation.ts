import { query } from "@/lib/db";
import { ARMED_SWING_RULES, resultsCalendarCoverage } from "@/lib/analytics/armedSwing";
import { isMarketOpenNow, refreshMarketHolidays, tradingDayOffset, tradingSessionLag, zonedMarketClock } from "@/lib/market-calendar.mjs";

export type TrendContinuationStatus = "IMPULSE_DETECTED" | "CONTINUATION_WATCH" | "TREND_CONTINUATION_READY" | "EXTENDED_RISK";
export interface TrendContinuationCandidate {
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
  const requiredCoverageFrom = tradingDayOffset(market, sessionDate, 1);
  const requiredCoverageThrough = tradingDayOffset(market, sessionDate, ARMED_SWING_RULES.resultsBlackoutSessions);
  return rows.map((row) => {
    const execution = executionByAsset.get(row.asset_id);
    const number = (value: string | null | undefined) => value === null || value === undefined ? null : Number(value);
    const price = number(execution?.price);
    const bid = number(execution?.best_bid);
    const ask = number(execution?.best_ask);
    const lower = number(execution?.lower_circuit);
    const upper = number(execution?.upper_circuit);
    const entry = row.entry === null ? null : Number(row.entry);
    const quoteAgeMinutes = execution?.updated_at ? (Date.now() - Date.parse(execution.updated_at)) / 60_000 : Number.POSITIVE_INFINITY;
    const spreadPct = bid !== null && ask !== null && bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
    const lowerRoomPct = price !== null && lower !== null && lower > 0 ? ((price / lower) - 1) * 100 : null;
    const coverage = execution ? resultsCalendarCoverage({
      today: sessionDate, lastSuccessAt: execution.last_success_at, nextDate: execution.next_date,
      lastPastDate: execution.last_past_date, authoritativeSource: execution.authoritative_source,
      authoritativeAsOf: execution.authoritative_as_of, authoritativeCoverageFrom: execution.authoritative_coverage_from,
      authoritativeCoverageThrough: execution.authoritative_coverage_through,
      requiredCoverageFrom, requiredCoverageThrough,
    }) : { verified: false, detail: "Results calendar unavailable." };
    const sessionsToResults = execution?.next_date ? tradingSessionLag(market, sessionDate, execution.next_date) : null;
    const blockers: string[] = [];
    const dayTwoEntry = row.metrics.early_breakout === true || row.metrics.setup === "DAY_TWO_STAIRCASE";
    if (row.status !== "TREND_CONTINUATION_READY" || !row.ready || !dayTwoEntry) blockers.push("Only a confirmed day-two entry can be bought.");
    if (!marketOpen) blockers.push("Entry is available only during NSE market hours.");
    if (execution?.source !== "BREEZE_LIVE" || quoteAgeMinutes < 0 || quoteAgeMinutes > ARMED_SWING_RULES.maxQuoteAgeMinutes) blockers.push("A fresh Breeze quote is required.");
    if (spreadPct === null || spreadPct > ARMED_SWING_RULES.maxSpreadPct) blockers.push("Bid/ask spread is missing or above 0.75%.");
    if (lowerRoomPct === null || lowerRoomPct <= ARMED_SWING_RULES.minLowerCircuitRoomPct || upper === null || entry === null || entry > upper) blockers.push("Circuit-band execution room is not verified.");
    if (price === null || entry === null || row.target === null || price < entry * 0.999 || price >= Number(row.target)) blockers.push("Live price is outside the frozen entry-to-target range.");
    if (!coverage.verified) blockers.push(coverage.detail);
    if (sessionsToResults !== null && sessionsToResults <= ARMED_SWING_RULES.resultsBlackoutSessions) blockers.push(`Results are due within ${ARMED_SWING_RULES.resultsBlackoutSessions} sessions.`);
    if (Date.now() - Date.parse(row.computed_at) > 5 * 60_000) blockers.push("The continuation calculation is stale; wait for the next scan.");
    return {
      assetId: row.asset_id, ticker: row.ticker, name: row.name, status: row.status,
      ready: row.ready, observationOnly: blockers.length > 0, score: row.score,
      entry, stop: row.stop === null ? null : Number(row.stop), target: row.target === null ? null : Number(row.target),
      asOfMarketDate: row.asof_market_date, computedAt: row.computed_at, metrics: row.metrics, reasons: row.reasons,
      executionEligible: blockers.length === 0, executionBlockers: blockers, currentPrice: price,
    };
  }).sort(compareTrendCandidates).slice(0, limit);
}
