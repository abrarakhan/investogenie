import { query } from "@/lib/db";
import { resultsCalendarCoverage } from "@/lib/analytics/armedSwing";
import { tradingDayOffset, tradingSessionLag } from "@/lib/market-calendar.mjs";

export interface ResultsCheck {
  verified: boolean;
  detail: string;
  nextDate: string | null;
  sessionsToNext: number | null;
  source: string | null;
  sourceAsOf: string | null;
  coverageFrom: string | null;
  coverageThrough: string | null;
}

type ResultsRow = {
  asset_id: string;
  next_date: string | null;
  last_past_date: string | null;
  last_success_at: string | null;
  authoritative_source: string | null;
  authoritative_as_of: string | null;
  authoritative_coverage_from: string | null;
  authoritative_coverage_through: string | null;
};

/**
 * Company-results check for each asset on `sessionDate`, under the same coverage policy the
 * Armed screen uses. An asset absent from the map has no calendar row at all; a missing
 * calendar table leaves every asset absent (fail closed), not "no results".
 */
export async function loadResultsChecks(
  market: "IN" | "US",
  sessionDate: string,
  assetIds: string[],
): Promise<Map<string, ResultsCheck>> {
  const out = new Map<string, ResultsCheck>();
  if (!assetIds.length) return out;
  const rows = await query<ResultsRow>(
    `select a.id asset_id,
            (select min(e.event_date)::text from public.corporate_events e
              where e.asset_id=a.id and e.event_type='RESULTS' and e.event_date >= $2::date) next_date,
            (select max(e.event_date)::text from public.corporate_events e
              where e.asset_id=a.id and e.event_type='RESULTS' and e.event_date < $2::date) last_past_date,
            s.last_success_at::text last_success_at,
            s.authoritative_source,s.authoritative_as_of::text authoritative_as_of,
            s.authoritative_coverage_from::text authoritative_coverage_from,
            s.authoritative_coverage_through::text authoritative_coverage_through
       from unnest($1::uuid[]) a(id)
       left join public.corporate_event_sync_state s on s.asset_id=a.id`,
    [assetIds, sessionDate],
  ).catch((error) => {
    if ((error as { code?: string }).code === "42P01") return [] as ResultsRow[];
    throw error;
  });
  const requiredCoverageFrom = tradingDayOffset(market, sessionDate, 1);
  const requiredCoverageThrough = tradingDayOffset(market, sessionDate, 3);
  for (const row of rows) {
    const coverage = resultsCalendarCoverage({
      today: sessionDate,
      lastSuccessAt: row.last_success_at,
      nextDate: row.next_date,
      lastPastDate: row.last_past_date,
      authoritativeSource: row.authoritative_source,
      authoritativeAsOf: row.authoritative_as_of,
      authoritativeCoverageFrom: row.authoritative_coverage_from,
      authoritativeCoverageThrough: row.authoritative_coverage_through,
      requiredCoverageFrom,
      requiredCoverageThrough,
    });
    out.set(row.asset_id, {
      verified: coverage.verified,
      detail: coverage.detail,
      nextDate: row.next_date,
      sessionsToNext: row.next_date ? tradingSessionLag(market, sessionDate, row.next_date) : null,
      source: row.authoritative_source,
      sourceAsOf: row.authoritative_as_of,
      coverageFrom: row.authoritative_coverage_from,
      coverageThrough: row.authoritative_coverage_through,
    });
  }
  return out;
}
