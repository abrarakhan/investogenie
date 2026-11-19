import { query } from "@/lib/db";
import { tradingDayOffset, tradingSessionLag } from "@/lib/market-calendar.mjs";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";

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

export interface ResultsEvidence {
  today: string;
  lastSuccessAt: string | null;
  nextDate: string | null;
  lastPastDate: string | null;
  sessionsToNext: number | null;
  authoritativeSource: string | null;
  authoritativeAsOf: string | null;
  authoritativeCoverageFrom: string | null;
  authoritativeCoverageThrough: string | null;
  requiredCoverageFrom: string | null;
  requiredCoverageThrough: string | null;
}

/**
 * Load raw corporate-results evidence for Python strategy engines so coverage can be
 * evaluated inside the strategy worker batch without spawning a separate `results_coverage`
 * process. A missing calendar table leaves every asset absent (fail closed).
 */
export async function loadResultsEvidence(
  market: "IN" | "US",
  sessionDate: string,
  assetIds: string[],
): Promise<Map<string, ResultsEvidence>> {
  const out = new Map<string, ResultsEvidence>();
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
    out.set(row.asset_id, {
      today: sessionDate,
      lastSuccessAt: row.last_success_at,
      nextDate: row.next_date,
      lastPastDate: row.last_past_date,
      sessionsToNext: row.next_date ? tradingSessionLag(market, sessionDate, row.next_date) : null,
      authoritativeSource: row.authoritative_source,
      authoritativeAsOf: row.authoritative_as_of,
      authoritativeCoverageFrom: row.authoritative_coverage_from,
      authoritativeCoverageThrough: row.authoritative_coverage_through,
      requiredCoverageFrom,
      requiredCoverageThrough,
    });
  }
  return out;
}

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
  const evidenceByAsset = await loadResultsEvidence(market, sessionDate, assetIds);
  const entries = [...evidenceByAsset.entries()];
  const coverageRows = await runPythonStrategyBatch<ResultsEvidence, { verified: boolean; detail: string }>(
    "results_coverage", entries.map(([, item]) => item),
  );
  for (let index = 0; index < entries.length; index++) {
    const [assetId, item] = entries[index];
    const coverage = coverageRows[index];
    out.set(assetId, {
      verified: coverage.verified,
      detail: coverage.detail,
      nextDate: item.nextDate,
      sessionsToNext: item.sessionsToNext,
      source: item.authoritativeSource,
      sourceAsOf: item.authoritativeAsOf,
      coverageFrom: item.authoritativeCoverageFrom,
      coverageThrough: item.authoritativeCoverageThrough,
    });
  }
  return out;
}
