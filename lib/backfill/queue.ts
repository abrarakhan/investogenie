import { query, queryOne, tx } from "@/lib/db";
import { shouldSkipMarketForBackfill } from "./classifier";
import { planQueueRows } from "./planner";
import type {
  BackfillCandidate,
  BackfillMarket,
  BackfillQueueItem,
  BackfillStatusSummary,
  PopulateBackfillSummary,
  QueueStatusRow,
} from "./types";

interface CandidateRow {
  asset_id: string;
  symbol: string;
  market: BackfillMarket;
  exchange: string | null;
  latest_volume: string | number | null;
  in_nifty500: boolean;
  in_sp500: boolean;
  in_nasdaq100: boolean;
  in_portfolio: boolean;
  in_watchlist: boolean;
  has_active_signal: boolean;
  has_open_forward_test: boolean;
}

const parseDetail = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

export function rowToCandidate(row: CandidateRow): BackfillCandidate {
  return {
    assetId: row.asset_id,
    symbol: row.symbol,
    market: row.market,
    exchange: row.exchange,
    latestVolume: row.latest_volume === null ? null : Number(row.latest_volume),
    inNifty500: row.in_nifty500,
    inSp500: row.in_sp500,
    inNasdaq100: row.in_nasdaq100,
    inPortfolio: row.in_portfolio,
    inWatchlist: row.in_watchlist,
    hasActiveSignal: row.has_active_signal,
    hasOpenForwardTest: row.has_open_forward_test,
  };
}

export async function getBackfillCandidates(): Promise<BackfillCandidate[]> {
  const rows = await query<CandidateRow>(
    `with hist as (
       select asset_id, count(*) bar_count from public.daily_ohlcv group by asset_id
     )
     select a.id::text asset_id,
            a.ticker symbol,
            a.country::text market,
            a.exchange::text exchange,
            coalesce(ss.volume, 0) latest_volume,
            exists(select 1 from public.universe_members u where u.asset_id=a.id and u.universe='NIFTY_500') in_nifty500,
            exists(select 1 from public.universe_members u where u.asset_id=a.id and u.universe='SP_500') in_sp500,
            exists(select 1 from public.universe_members u where u.asset_id=a.id and u.universe='NASDAQ_100') in_nasdaq100,
            exists(select 1 from public.holdings h where h.asset_id=a.id) in_portfolio,
            exists(select 1 from public.watchlist_items w where w.asset_id=a.id) in_watchlist,
            exists(select 1 from public.swing_signals s where s.asset_id=a.id and s.verdict <> 'NO_SETUP') has_active_signal,
            exists(select 1 from public.forward_test_positions f where f.asset_id=a.id and f.status='OPEN') has_open_forward_test
       from public.assets a
       join public.latest_quotes q on q.asset_id=a.id
       left join hist on hist.asset_id=a.id
       left join public.stock_snapshot ss on ss.asset_id=a.id
      where a.asset_class='STOCK'
        and (
          (a.country='IN' and a.exchange in ('NSE','BSE'))
          or (a.country='US' and coalesce(a.exchange, '') in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN'))
        )
        and (
          a.country <> 'IN'
          or (
            a.ticker !~ '-RE[0-9]*$'
            and q.source = a.exchange || '_BHAVCOPY'
          )
        )
        and coalesce(hist.bar_count, 0)=0`,
  );
  return rows.map(rowToCandidate);
}

async function pruneUnsupportedBackfillItems() {
  await query(
    `delete from public.backfill_queue q
      using public.assets a
     where q.asset_id = a.id
       and not (
         a.asset_class='STOCK'
         and (
           (a.country='IN' and a.exchange in ('NSE','BSE'))
           or (a.country='US' and coalesce(a.exchange, '') in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN'))
         )
         and (
           a.country <> 'IN'
           or a.ticker !~ '-RE[0-9]*$'
         )
       )`,
  );
}

export async function populateBackfillQueue(): Promise<PopulateBackfillSummary> {
  await pruneUnsupportedBackfillItems();
  const candidates = await getBackfillCandidates();
  const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  if (candidates.length === 0) return { inserted: 0, tierCounts };

  const values: string[] = [];
  const params: unknown[] = [];
  const cols = 4;
  planQueueRows(candidates).forEach((candidate, index) => {
    tierCounts[candidate.tier] = (tierCounts[candidate.tier] ?? 0) + 1;
    const offset = index * cols;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
    params.push(candidate.assetId, candidate.symbol, candidate.market, candidate.tier);
  });

  const rows = await query<{ inserted: string }>(
    `insert into public.backfill_queue (asset_id, symbol, market, tier)
     values ${values.join(",")}
     on conflict (asset_id) do update set
       symbol=excluded.symbol,
       market=excluded.market,
       tier=excluded.tier,
       status=case
         when public.backfill_queue.status in ('done','skipped','in_progress') then public.backfill_queue.status
         else 'pending'
       end,
       attempts=case
         when public.backfill_queue.status in ('done','skipped','in_progress') then public.backfill_queue.attempts
         else 0
       end,
       last_error=case
         when public.backfill_queue.status in ('done','skipped','in_progress') then public.backfill_queue.last_error
         else null
       end,
       queued_at=case
         when public.backfill_queue.status in ('done','skipped','in_progress') then public.backfill_queue.queued_at
         else now()
       end
     returning 1 inserted`,
    params,
  );
  return { inserted: rows.length, tierCounts };
}

export async function isBackfillRunning(): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `select exists(
       select 1 from public.backfill_queue
        where status='in_progress' and started_at > now() - interval '30 minutes'
     )`,
  );
  return row?.exists ?? false;
}

export async function claimNextBackfillItem({
  skipDuringMarketHours,
  now = new Date(),
}: {
  skipDuringMarketHours: boolean;
  now?: Date;
}): Promise<BackfillQueueItem | null> {
  return tx(async (client) => {
    const { rows } = await client.query<{
      id: number;
      asset_id: string;
      symbol: string;
      market: BackfillMarket;
      tier: number;
      attempts: number;
      exchange: string | null;
    }>(
      `select q.id, q.asset_id::text, q.symbol, q.market::text, q.tier, q.attempts, a.exchange::text exchange
         from public.backfill_queue q
         join public.assets a on a.id = q.asset_id
        where q.status='pending'
          and a.asset_class='STOCK'
          and (
            (a.country='IN' and a.exchange in ('NSE','BSE'))
            or (a.country='US' and coalesce(a.exchange, '') in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN'))
          )
          and (
            a.country <> 'IN'
            or a.ticker !~ '-RE[0-9]*$'
          )
        order by q.tier asc, q.queued_at asc
        for update skip locked
        limit 20`,
    );
    const row = rows.find((candidate) => !shouldSkipMarketForBackfill({ market: candidate.market, skipDuringMarketHours, at: now }));
    if (!row) return null;
    await client.query(
      `update public.backfill_queue
          set status='in_progress', started_at=now(), last_error=null
        where id=$1`,
      [row.id],
    );
    return {
      id: row.id,
      assetId: row.asset_id,
      symbol: row.symbol,
      market: row.market,
      exchange: row.exchange,
      tier: row.tier,
      attempts: row.attempts,
    };
  });
}

export async function markBackfillDone(id: number, barsLoaded: number) {
  await query(
    `update public.backfill_queue
        set status=$2, bars_loaded=$3, completed_at=now(), last_error=null
      where id=$1`,
    [id, barsLoaded > 0 ? "done" : "skipped", barsLoaded],
  );
}

export async function markBackfillFailed(id: number, error: string, maxAttempts = 3) {
  await query(
    `update public.backfill_queue
        set attempts=attempts+1,
            last_error=$2,
            status=case when attempts + 1 >= $3 then 'failed' else 'pending' end,
            completed_at=case when attempts + 1 >= $3 then now() else completed_at end
      where id=$1`,
    [id, error.slice(0, 2000), maxAttempts],
  );
}

export async function requeueFailedBackfillItems(): Promise<number> {
  const rows = await query<{ id: number }>(
    `update public.backfill_queue
        set status='pending', attempts=0, last_error=null, started_at=null, completed_at=null
      where status='failed'
      returning id`,
  );
  return rows.length;
}

async function reconcileCoveredBackfillItems(): Promise<void> {
  await query(
    `with hist as (
       select asset_id, count(*)::int bar_count
         from public.daily_ohlcv
        group by asset_id
     )
     update public.backfill_queue q
        set status='done',
            bars_loaded=greatest(coalesce(q.bars_loaded, 0), hist.bar_count),
            completed_at=coalesce(q.completed_at, now()),
            last_error=null
       from hist
      where hist.asset_id = q.asset_id
        and hist.bar_count > 0
        and q.status in ('pending','failed','skipped')`,
  );
}

export async function getBackfillStatusSummary(): Promise<BackfillStatusSummary> {
  await reconcileCoveredBackfillItems();
  const [rows, activeRows, lastRunRows] = await Promise.all([
    query<{ tier: number; status: QueueStatusRow["status"]; count: string }>(
      `select tier, status, count(*)::text count
         from public.backfill_queue
        group by tier, status
        order by tier, status`,
    ),
    query<{ symbol: string; market: BackfillMarket; tier: number; exchange: string | null; started_at: Date | string | null }>(
      `select q.symbol, q.market::text, q.tier, a.exchange::text exchange, q.started_at
         from public.backfill_queue q
         left join public.assets a on a.id=q.asset_id
        where q.status='in_progress'
        order by started_at asc nulls last, tier asc
        limit 8`,
    ),
    query<{ created_at: Date | string; duration_ms: string | number | null; status: string; detail: unknown; error: string | null }>(
      `select created_at, duration_ms, status, detail, error
         from public.cron_logs
        where job in ('backfill_ohlcv', 'backfill_ohlcv_cron', 'backfill-nse', 'backfill-bse')
        order by created_at desc
        limit 1`,
    ),
  ]);
  const summaryRows = rows.map((row) => ({ tier: Number(row.tier), status: row.status, count: Number(row.count) }));
  const total = summaryRows.reduce((sum, row) => sum + row.count, 0);
  const byStatus = (status: QueueStatusRow["status"]) => summaryRows.filter((row) => row.status === status).reduce((sum, row) => sum + row.count, 0);
  const done = byStatus("done");
  const skipped = byStatus("skipped");
  const pending = byStatus("pending");
  const inProgress = byStatus("in_progress");
  const failed = byStatus("failed");
  const lowestPendingTier = summaryRows.filter((row) => row.status === "pending" && row.count > 0).sort((a, b) => a.tier - b.tier)[0]?.tier ?? null;
  const finished = done + skipped + failed;
  const avgSeconds = 1.5;
  return {
    rows: summaryRows,
    total,
    pending,
    inProgress,
    done,
    failed,
    skipped,
    active: activeRows.map((row) => ({
      symbol: row.symbol,
      market: row.market,
      exchange: row.exchange,
      tier: Number(row.tier),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    })),
    percentDone: total === 0 ? 100 : (finished / total) * 100,
    lowestPendingTier,
    running: inProgress > 0,
    estimatedMinutesRemaining: pending === 0 ? null : (pending * avgSeconds) / 60,
    lastRun: lastRunRows[0] ? {
      createdAt: new Date(lastRunRows[0].created_at).toISOString(),
      durationMs: lastRunRows[0].duration_ms === null ? null : Number(lastRunRows[0].duration_ms),
      status: lastRunRows[0].status,
      detail: parseDetail(lastRunRows[0].detail),
      error: lastRunRows[0].error,
    } : null,
  };
}
