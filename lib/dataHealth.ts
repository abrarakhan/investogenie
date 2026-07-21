import { query, queryOne } from "@/lib/db";
import type { FreshnessStatus } from "@/lib/status";
import { getBackfillStatusSummary } from "@/lib/backfill/queue";
import type { BackfillStatusSummary } from "@/lib/backfill/types";

export type HealthSeverity = "critical" | "high" | "medium" | "low";
export type HealthMarket = "IN" | "US" | "ALL";

export interface SourceHealthCard {
  source: string;
  status: FreshnessStatus;
  lastSuccessAt: string | null;
  recordCount: number;
  detail: string;
}

export interface CoverageGapInput {
  symbol: string;
  market: "IN" | "US";
  hasQuote?: boolean;
  quoteUpdatedAt?: string | null;
  hasHistory?: boolean;
  latestHistoryDate?: string | null;
  inUniverse?: boolean;
  hasFundamentals?: boolean;
  latestFundamentalsDate?: string | null;
  activeSwingSignal?: boolean;
  openForwardTest?: boolean;
  now?: string;
}

export interface CoverageGap {
  symbol: string;
  market: "IN" | "US";
  issueType: string;
  detail: string;
  severity: HealthSeverity;
  gapDays: number | null;
  action: string;
}

export interface SeverityCounts { critical: number; high: number; medium: number; low: number }

export interface CronLogEntry {
  id: number;
  job: string;
  status: string;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  detail: Record<string, unknown>;
}

export interface DataHealthPageData {
  generatedAt: string;
  sources: SourceHealthCard[];
  gaps: CoverageGap[];
  severityCounts: SeverityCounts;
  recentRuns: CronLogEntry[];
  worstStatus: FreshnessStatus;
  backfill: BackfillStatusSummary;
  quoteNoHistoryCount: number;
}

const severityRank: Record<HealthSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const statusRank: Record<FreshnessStatus, number> = { failed: 0, stale: 1, unknown: 2, fresh: 3, off_hours: 4 };

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysBetween(laterRaw: string, earlierRaw: string | null | undefined): number | null {
  const later = asDate(laterRaw);
  const earlier = asDate(earlierRaw);
  if (!later || !earlier) return null;
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
}

export function hoursBetween(laterRaw: string, earlierRaw: string | null | undefined): number | null {
  const later = asDate(laterRaw);
  const earlier = asDate(earlierRaw);
  if (!later || !earlier) return null;
  return (later.getTime() - earlier.getTime()) / 3_600_000;
}

export function classifyFreshness({
  lastSuccessAt,
  failed,
  cadenceHours,
  now,
  offHours = false,
}: {
  lastSuccessAt: string | null;
  failed?: boolean;
  cadenceHours: number;
  now: string;
  offHours?: boolean;
}): FreshnessStatus {
  if (failed) return "failed";
  if (!lastSuccessAt) return "failed";
  if (offHours) return "off_hours";
  const ageHours = hoursBetween(now, lastSuccessAt);
  if (ageHours === null) return "unknown";
  if (ageHours <= cadenceHours) return "fresh";
  if (ageHours <= cadenceHours * 3) return "stale";
  return "failed";
}

export function classifyCoverageGaps(input: CoverageGapInput): CoverageGap[] {
  const now = input.now ?? new Date().toISOString();
  const gaps: CoverageGap[] = [];
  const historyGap = daysBetween(now, input.latestHistoryDate);
  const quoteAge = hoursBetween(now, input.quoteUpdatedAt);
  const staleQuote = input.hasQuote && (quoteAge === null || quoteAge > 1);
  const staleHistory = input.hasHistory && (historyGap === null || historyGap > 3);

  if (input.hasQuote && !input.hasHistory) {
    gaps.push({
      symbol: input.symbol,
      market: input.market,
      issueType: "Quote but no history",
      detail: "Latest quote exists, but no OHLCV bars are available.",
      severity: input.market === "IN" ? "high" : "medium",
      gapDays: null,
      action: "Backfill history",
    });
  }

  if (staleHistory) {
    gaps.push({
      symbol: input.symbol,
      market: input.market,
      issueType: "History stale",
      detail: `Latest OHLCV bar is ${historyGap ?? "unknown"} days old.`,
      severity: "medium",
      gapDays: historyGap,
      action: "Backfill history",
    });
  }

  if (input.inUniverse && !input.hasFundamentals) {
    gaps.push({
      symbol: input.symbol,
      market: input.market,
      issueType: "No fundamentals",
      detail: "Asset is in a screener universe but has no financial reports.",
      severity: "medium",
      gapDays: null,
      action: "Sync fundamentals",
    });
  }

  const fundamentalsGap = daysBetween(now, input.latestFundamentalsDate);
  if (input.hasFundamentals && fundamentalsGap !== null && fundamentalsGap > 183) {
    gaps.push({
      symbol: input.symbol,
      market: input.market,
      issueType: "Stale fundamentals",
      detail: `Latest financial report is ${fundamentalsGap} days old.`,
      severity: "low",
      gapDays: fundamentalsGap,
      action: "Sync fundamentals",
    });
  }

  if (staleQuote) {
    gaps.push({
      symbol: input.symbol,
      market: input.market,
      issueType: "Quote age",
      detail: `Latest quote update is ${quoteAge === null ? "unknown" : `${quoteAge.toFixed(1)} hours`} old.`,
      severity: "medium",
      gapDays: null,
      action: "Sync quotes",
    });
  }

  if (input.activeSwingSignal && (staleQuote || staleHistory || !input.hasHistory)) {
    gaps.push({
      symbol: input.symbol,
      market: input.market,
      issueType: "Swing signal on stale data",
      detail: "A visible buy candidate depends on stale quote or OHLCV data.",
      severity: "critical",
      gapDays: historyGap,
      action: "Refresh before trusting signal",
    });
  }

  if (input.openForwardTest && staleQuote) {
    gaps.push({
      symbol: input.symbol,
      market: input.market,
      issueType: "Forward-test on stale data",
      detail: "An open forward-test position cannot evaluate reliably with stale quotes.",
      severity: "critical",
      gapDays: null,
      action: "Sync quotes",
    });
  }

  return gaps.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

export function worstFreshnessStatus(statuses: FreshnessStatus[]): FreshnessStatus {
  return statuses.reduce<FreshnessStatus>((worst, status) => statusRank[status] < statusRank[worst] ? status : worst, "fresh");
}

export function countSeverities(gaps: CoverageGap[]): SeverityCounts {
  return gaps.reduce<SeverityCounts>((acc, gap) => {
    acc[gap.severity]++;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0 });
}

const iso = (value: Date | string | null): string | null => value ? new Date(value).toISOString() : null;

interface SourceRow { source: string; last_success_at: Date | string | null; record_count: string | number; failed: boolean; cadence_hours: string | number; detail: string }

export async function getDataHealthSummary(now = new Date()): Promise<SourceHealthCard[]> {
  const nowIso = now.toISOString();
  const rows = await query<SourceRow>(
    `with latest_cron as (
       select distinct on (job) job, status, error, created_at
         from public.cron_logs
        order by job, created_at desc
     ), counts as (
       select 'NSE Quotes' source, max(q.updated_at) last_success_at, count(*) record_count, 1 cadence_hours, 'NSE latest quote rows' detail
         from public.latest_quotes q join public.assets a on a.id=q.asset_id where a.country='IN' and a.exchange='NSE' and a.asset_class='STOCK'
       union all
       select 'BSE Quotes', max(q.updated_at), count(*), 1, 'BSE/inferred Indian quote rows'
         from public.latest_quotes q join public.assets a on a.id=q.asset_id where a.country='IN' and a.exchange='BSE'
       union all
       select 'NSE OHLCV History', max(o.date)::timestamptz, count(distinct o.asset_id), 24, 'NSE assets with OHLCV bars'
         from public.daily_ohlcv o join public.assets a on a.id=o.asset_id where a.country='IN' and a.exchange='NSE' and a.asset_class='STOCK'
       union all
       select 'BSE OHLCV History', max(o.date)::timestamptz, count(distinct o.asset_id), 24, 'BSE assets with OHLCV bars'
         from public.daily_ohlcv o join public.assets a on a.id=o.asset_id where a.country='IN' and a.exchange='BSE' and a.asset_class='STOCK'
       union all
       select 'US Quotes', max(q.updated_at), count(*), 1, 'US latest quote rows'
         from public.latest_quotes q join public.assets a on a.id=q.asset_id where a.country='US' and a.asset_class='STOCK'
       union all
       select 'US OHLCV History', max(o.date)::timestamptz, count(distinct o.asset_id), 24, 'US assets with OHLCV bars'
         from public.daily_ohlcv o join public.assets a on a.id=o.asset_id where a.country='US' and a.asset_class='STOCK'
       union all
       select 'US Fundamentals', max(f.updated_at), count(distinct f.asset_id), 168, 'US financial report rows'
         from public.asset_financial_reports f join public.assets a on a.id=f.asset_id where a.country='US'
       union all
       select 'India Fundamentals', max(f.updated_at), count(distinct f.asset_id), 168, 'India financial report rows'
         from public.asset_financial_reports f join public.assets a on a.id=f.asset_id where a.country='IN'
       union all
       select 'Macro Indicators', max(m.date)::timestamptz, count(*), 168, 'Macro indicator rows'
         from public.macro_indicators m
       union all
       select 'AMC Fund Snapshots', max(fs.last_synced_at), count(distinct fs.scheme_code), 840, 'Loaded AMC monthly portfolio disclosures'
         from public.fund_schemes fs
       union all
       select 'CAS Imports', max(h.updated_at), count(*), 840, 'Imported user holdings'
         from public.holdings h join public.assets a on a.id=h.asset_id where a.asset_class='MUTUAL_FUND'
     )
     select c.*, coalesce(l.status='error', false) failed
       from counts c
       left join latest_cron l on lower(c.source) like '%' || replace(l.job, '-', ' ') || '%'`,
  );
  return rows.map((row) => ({
    source: row.source,
    status: classifyFreshness({ lastSuccessAt: iso(row.last_success_at), failed: row.failed, cadenceHours: Number(row.cadence_hours), now: nowIso }),
    lastSuccessAt: iso(row.last_success_at),
    recordCount: Number(row.record_count),
    detail: row.detail,
  }));
}

export async function getWorstDataHealthStatus(): Promise<FreshnessStatus> {
  try {
    return worstFreshnessStatus((await getDataHealthSummary()).map((card) => card.status));
  } catch {
    return "unknown";
  }
}

interface AssetGapRow {
  symbol: string;
  market: "IN" | "US";
  quote_updated_at: Date | string | null;
  latest_history_date: Date | string | null;
  latest_fundamentals_date: Date | string | null;
  in_universe: boolean;
  active_swing_signal: boolean;
  open_forward_test: boolean;
}

interface CronLogRow {
  id: string | number;
  job: string;
  status: string;
  error: string | null;
  duration_ms: string | number | null;
  created_at: Date | string;
  detail: Record<string, unknown> | string | null;
}

function parseDetail(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function getCoverageGaps(userId: string, now = new Date()): Promise<CoverageGap[]> {
  const rows = await query<AssetGapRow>(
    `with hist as (select asset_id, max(date) latest_history_date from public.daily_ohlcv group by asset_id),
          fin as (select asset_id, max(period_end_date) latest_fundamentals_date from public.asset_financial_reports group by asset_id),
          uni as (select distinct asset_id from public.universe_members where universe in ('NIFTY_500','SP_500')),
          swing as (select distinct asset_id from public.swing_signals where verdict <> 'NO_SETUP'),
          fwd as (select distinct asset_id from public.forward_test_positions where status = 'OPEN')
     select a.ticker symbol,
            a.country::text market,
            q.updated_at quote_updated_at,
            hist.latest_history_date,
            fin.latest_fundamentals_date,
            (uni.asset_id is not null) in_universe,
            (swing.asset_id is not null) active_swing_signal,
            (fwd.asset_id is not null) open_forward_test
       from public.assets a
       left join public.latest_quotes q on q.asset_id = a.id
       left join hist on hist.asset_id = a.id
       left join fin on fin.asset_id = a.id
       left join uni on uni.asset_id = a.id
       left join swing on swing.asset_id = a.id
       left join fwd on fwd.asset_id = a.id
      where a.asset_class = 'STOCK' and a.country in ('IN','US') and (q.asset_id is not null or uni.asset_id is not null or swing.asset_id is not null or fwd.asset_id is not null)
      order by a.country, a.ticker
      limit 8000`,
  );

  const nowIso = now.toISOString();
  const assetGaps = rows.flatMap((row) => classifyCoverageGaps({
    symbol: row.symbol,
    market: row.market,
    hasQuote: row.quote_updated_at !== null,
    quoteUpdatedAt: iso(row.quote_updated_at),
    hasHistory: row.latest_history_date !== null,
    latestHistoryDate: iso(row.latest_history_date),
    inUniverse: row.in_universe,
    hasFundamentals: row.latest_fundamentals_date !== null,
    latestFundamentalsDate: iso(row.latest_fundamentals_date),
    activeSwingSignal: row.active_swing_signal,
    openForwardTest: row.open_forward_test,
    now: nowIso,
  }));

  const fundRows = await query<{ fund_name: string; isin: string | null; status: string }>(
    `select coalesce(a.name, a.ticker) fund_name,
            nullif(m.amfi_code_in, '') isin,
            coalesce(map.status, 'pending') status
       from public.holdings h
       join public.assets a on a.id = h.asset_id
       left join public.mutual_fund_meta m on m.asset_id = a.id
       left join public.user_fund_mappings map on map.user_id = h.user_id and map.user_holding_id = h.id and map.status = 'matched'
      where h.user_id = $1 and a.asset_class = 'MUTUAL_FUND' and h.quantity > 0 and map.id is null
      order by a.name nulls last, a.ticker`,
    [userId],
  );
  const fundGaps: CoverageGap[] = fundRows.map((row) => ({
    symbol: row.fund_name,
    market: "IN",
    issueType: "Fund snapshot gap",
    detail: `Imported fund has no matched AMC snapshot${row.isin ? ` (${row.isin})` : ""}.`,
    severity: "high",
    gapDays: null,
    action: "Go to Fund Mapping",
  }));

  return [...assetGaps, ...fundGaps].sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.symbol.localeCompare(b.symbol));
}

export async function getRecentCronLogs(limit = 50): Promise<CronLogEntry[]> {
  const rows = await query<CronLogRow>(
    `select id, job, status, error, duration_ms, created_at, detail
       from public.cron_logs
      order by created_at desc
      limit $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    job: row.job,
    status: row.status,
    error: row.error,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    createdAt: iso(row.created_at) ?? "",
    detail: parseDetail(row.detail),
  }));
}

export async function getQuoteNoHistoryCount(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `with hist as (select asset_id from public.daily_ohlcv group by asset_id)
     select count(*)::text
       from public.assets a
       join public.latest_quotes q on q.asset_id = a.id
       left join hist on hist.asset_id = a.id
      where a.asset_class='STOCK'
        and a.country in ('IN','US')
        and hist.asset_id is null`,
  );
  return Number(row?.count ?? 0);
}

export async function getDataHealthPageData(userId: string): Promise<DataHealthPageData> {
  const now = new Date();
  const [sources, gaps, recentRuns, backfill, quoteNoHistoryCount] = await Promise.all([
    getDataHealthSummary(now),
    getCoverageGaps(userId, now),
    getRecentCronLogs(50),
    getBackfillStatusSummary(),
    getQuoteNoHistoryCount(),
  ]);
  return {
    generatedAt: now.toISOString(),
    sources,
    gaps,
    severityCounts: countSeverities(gaps),
    recentRuns,
    worstStatus: worstFreshnessStatus(sources.map((source) => source.status)),
    backfill,
    quoteNoHistoryCount,
  };
}
