import { query, queryOne } from "@/lib/db";

export interface CronRunSummary {
  job: string;
  totalRuns: number;
  okRuns: number;
  errorRuns: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  avgDurationMs: number | null;
}

export interface RecentCronRun {
  id: number;
  job: string;
  status: string;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  detail: Record<string, unknown>;
}

export interface QuoteProviderSummary {
  provider: string;
  attempted: number;
  succeeded: number;
  failed: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  sampleError: string | null;
}

export interface FundamentalsProviderSummary {
  country: string;
  provider: string;
  attempted: number;
  succeeded: number;
  failed: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  sampleError: string | null;
}

export interface MarketFreshnessSummary {
  country: string;
  assets: number;
  quotes: number;
  history: number;
  fundamentals: number;
  latestQuoteDate: string | null;
  latestQuoteUpdatedAt: string | null;
  latestHistoryDate: string | null;
  latestFundamentalsPeriod: string | null;
}

export interface SyncStatusData {
  generatedAt: string;
  markets: MarketFreshnessSummary[];
  cron: CronRunSummary[];
  recentRuns: RecentCronRun[];
  quoteProviders: QuoteProviderSummary[];
  fundamentalsProviders: FundamentalsProviderSummary[];
}

interface CronRow {
  job: string;
  total_runs: string;
  ok_runs: string;
  error_runs: string;
  last_run_at: Date | string | null;
  last_status: string | null;
  last_error: string | null;
  avg_duration_ms: string | number | null;
}

interface RecentCronRow {
  id: string | number;
  job: string;
  status: string;
  error: string | null;
  duration_ms: string | number | null;
  created_at: Date | string;
  detail: Record<string, unknown> | string | null;
}

interface QuoteProviderRow {
  provider: string;
  attempted: string;
  succeeded: string;
  failed: string;
  last_attempt_at: Date | string | null;
  last_success_at: Date | string | null;
  sample_error: string | null;
}

interface FundamentalsProviderRow {
  country: string;
  provider: string;
  attempted: string;
  succeeded: string;
  failed: string;
  last_attempt_at: Date | string | null;
  last_success_at: Date | string | null;
  sample_error: string | null;
}

interface MarketFreshnessRow {
  country: string;
  assets: string;
  quotes: string;
  history: string;
  fundamentals: string;
  latest_quote_date: Date | string | null;
  latest_quote_updated_at: Date | string | null;
  latest_history_date: Date | string | null;
  latest_fundamentals_period: Date | string | null;
}

const isoDateTime = (value: Date | string | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const dateOnly = (value: Date): string => {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const isoDate = (value: Date | string | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? dateOnly(value) : value;
};

function parseDetail(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value;
}

export async function getSyncStatus(): Promise<SyncStatusData> {
  const [markets, cron, recentRuns, quoteProviders, fundamentalsProviders, generated] = await Promise.all([
    query<MarketFreshnessRow>(
      `select a.country,
              count(distinct a.id)::text assets,
              count(distinct q.asset_id)::text quotes,
              count(distinct o.asset_id)::text history,
              count(distinct f.asset_id)::text fundamentals,
              max(q.as_of) latest_quote_date,
              max(q.updated_at) latest_quote_updated_at,
              max(o.latest_date) latest_history_date,
              max(f.latest_period) latest_fundamentals_period
         from public.assets a
         left join public.latest_quotes q on q.asset_id=a.id
         left join (
           select asset_id,max(date) latest_date from public.daily_ohlcv group by asset_id
         ) o on o.asset_id=a.id
         left join (
           select asset_id,max(period_end_date) latest_period from public.asset_financial_reports group by asset_id
         ) f on f.asset_id=a.id
        where a.asset_class='STOCK' and a.country in ('US','IN')
        group by a.country
        order by a.country`,
    ),
    query<CronRow>(
      `select distinct on (job)
              job,
              count(*) over (partition by job)::text total_runs,
              count(*) filter (where status='ok') over (partition by job)::text ok_runs,
              count(*) filter (where status='error') over (partition by job)::text error_runs,
              created_at last_run_at,
              status last_status,
              error last_error,
              avg(duration_ms) over (partition by job) avg_duration_ms
         from public.cron_logs
        order by job, created_at desc`,
    ),
    query<RecentCronRow>(
      `select id,job,status,error,duration_ms,created_at,detail
         from public.cron_logs
        order by created_at desc
        limit 20`,
    ),
    query<QuoteProviderRow>(
      `select provider,
              count(*)::text attempted,
              count(*) filter (where last_success_at is not null)::text succeeded,
              count(*) filter (where last_success_at is null)::text failed,
              max(last_attempt_at) last_attempt_at,
              max(last_success_at) last_success_at,
              (array_agg(last_error order by last_attempt_at desc) filter (where last_error is not null))[1] sample_error
         from public.quote_sync_state
        group by provider
        order by provider`,
    ),
    query<FundamentalsProviderRow>(
      `select country,provider,
              count(*)::text attempted,
              count(*) filter (where last_success_at is not null)::text succeeded,
              count(*) filter (where last_success_at is null)::text failed,
              max(last_attempt_at) last_attempt_at,
              max(last_success_at) last_success_at,
              (array_agg(last_error order by last_attempt_at desc) filter (where last_error is not null))[1] sample_error
         from public.fundamentals_sync_state
        group by country,provider
        order by country,provider`,
    ),
    queryOne<{ now: Date }>("select now()"),
  ]);

  return {
    generatedAt: isoDateTime(generated?.now ?? new Date()) ?? new Date().toISOString(),
    markets: markets.map((row) => ({
      country: row.country,
      assets: Number(row.assets),
      quotes: Number(row.quotes),
      history: Number(row.history),
      fundamentals: Number(row.fundamentals),
      latestQuoteDate: isoDate(row.latest_quote_date),
      latestQuoteUpdatedAt: isoDateTime(row.latest_quote_updated_at),
      latestHistoryDate: isoDate(row.latest_history_date),
      latestFundamentalsPeriod: isoDate(row.latest_fundamentals_period),
    })),
    cron: cron.map((row) => ({
      job: row.job,
      totalRuns: Number(row.total_runs),
      okRuns: Number(row.ok_runs),
      errorRuns: Number(row.error_runs),
      lastRunAt: isoDateTime(row.last_run_at),
      lastStatus: row.last_status,
      lastError: row.last_error,
      avgDurationMs: row.avg_duration_ms === null ? null : Number(row.avg_duration_ms),
    })),
    recentRuns: recentRuns.map((row) => ({
      id: Number(row.id),
      job: row.job,
      status: row.status,
      error: row.error,
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      createdAt: isoDateTime(row.created_at) ?? "",
      detail: parseDetail(row.detail),
    })),
    quoteProviders: quoteProviders.map((row) => ({
      provider: row.provider,
      attempted: Number(row.attempted),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      lastAttemptAt: isoDateTime(row.last_attempt_at),
      lastSuccessAt: isoDateTime(row.last_success_at),
      sampleError: row.sample_error,
    })),
    fundamentalsProviders: fundamentalsProviders.map((row) => ({
      country: row.country,
      provider: row.provider,
      attempted: Number(row.attempted),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      lastAttemptAt: isoDateTime(row.last_attempt_at),
      lastSuccessAt: isoDateTime(row.last_success_at),
      sampleError: row.sample_error,
    })),
  };
}
