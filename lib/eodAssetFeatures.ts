import { query, tx } from "@/lib/db";
import { isMarketOpenNow, refreshMarketHolidays, zonedMarketClock } from "@/lib/market-calendar.mjs";

export interface EodFeaturesMeta {
  market: "IN" | "US";
  cutoffDate: string;
  latestBarDate: string;
  rowCount: number;
  refreshedAt: string;
}

export function nextCalendarDate(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Pure freshness contract for `public.eod_asset_features`:
 * - Must have materialized rows covering at least `expectedSession`.
 * - While `marketOpen` is true, `cutoffDate` must be `<= sessionDate` so today's
 *   in-progress candle can never enter completed-bar SMAs, pivots, or RS ranks.
 * - While `marketOpen` is false, `cutoffDate` must be `<= nextCalendarDate(sessionDate)`.
 */
export function isEodFeaturesFresh(
  meta: Pick<EodFeaturesMeta, "cutoffDate" | "latestBarDate" | "rowCount"> | null,
  params: { marketOpen: boolean; sessionDate: string; expectedSession: string },
): boolean {
  if (!meta || meta.rowCount <= 0) return false;
  if (meta.latestBarDate < params.expectedSession) return false;
  if (params.marketOpen) {
    return meta.cutoffDate <= params.sessionDate || meta.latestBarDate < params.sessionDate;
  }
  return meta.cutoffDate <= nextCalendarDate(params.sessionDate);
}

interface MetaCacheEntry {
  at: number;
  meta: EodFeaturesMeta | null;
}

const META_TTL_MS = 30_000;
const state = ((globalThis as {
  __investogenieEodFeatures?: {
    meta: Map<string, MetaCacheEntry>;
    inflight: Map<string, Promise<EodFeaturesMeta | null>>;
  };
}).__investogenieEodFeatures ??= { meta: new Map(), inflight: new Map() });

export function resetEodAssetFeaturesCache(): void {
  state.meta.clear();
  state.inflight.clear();
}

async function readMeta(market: "IN" | "US"): Promise<EodFeaturesMeta | null> {
  const cached = state.meta.get(market);
  if (cached && Date.now() - cached.at < META_TTL_MS) return cached.meta;
  const rows = await query<{
    market: "IN" | "US";
    cutoff_date: string;
    latest_bar_date: string;
    row_count: number | string;
    refreshed_at: string;
  }>(
    `select market, cutoff_date::text, latest_bar_date::text, row_count, refreshed_at::text
       from public.eod_asset_features_meta where market = $1`,
    [market],
  ).catch((error) => {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  });
  if (rows === null) return null;
  const row = rows[0];
  const meta: EodFeaturesMeta | null = row
    ? {
      market: row.market,
      cutoffDate: row.cutoff_date.slice(0, 10),
      latestBarDate: row.latest_bar_date.slice(0, 10),
      rowCount: Number(row.row_count),
      refreshedAt: row.refreshed_at,
    }
    : null;
  state.meta.set(market, { at: Date.now(), meta });
  return meta;
}

/**
 * Rebuild `public.eod_asset_features` for one market in a single atomic transaction
 * using only completed sessions (`o.date < cutoffDate`).
 *
 * Formulas match `lib/strongSwing.ts` (`holding`), `lib/momentumIgnitionData.ts`
 * (`preliminarySql`), and `lib/armedSwing.ts` (`shortlist` + `rs`) verbatim.
 */
export async function refreshEodAssetFeatures(
  market: "IN" | "US",
  opts?: { marketOpen?: boolean; sessionDate?: string },
): Promise<EodFeaturesMeta | null> {
  await refreshMarketHolidays(market).catch(() => false);
  const marketOpen = opts?.marketOpen ?? isMarketOpenNow(market);
  const sessionDate = opts?.sessionDate ?? zonedMarketClock(market).date;
  const cutoffDate = marketOpen ? sessionDate : nextCalendarDate(sessionDate);
  const key = `${market}:${cutoffDate}`;
  const existing = state.inflight.get(key);
  if (existing) return existing;

  const baseUniverseWhere = market === "IN"
    ? "a.country='IN' and a.exchange='NSE'"
    : "a.country='US'";
  const armedExchangeExpr = market === "IN"
    ? "a.exchange='NSE'"
    : "a.exchange in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN')";

  const run = (async (): Promise<EodFeaturesMeta | null> => {
    const meta = await tx(async (client) => {
      await client.query("delete from public.eod_asset_features where market = $1", [market]);
      const inserted = await client.query<{ row_count: string; latest_bar_date: string | null }>(
        `with universe as materialized (
           select a.id,
                  (${armedExchangeExpr}
                    and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)
                  ) as armed_eligible
             from public.assets a
            where ${baseUniverseWhere} and a.asset_class='STOCK' and a.is_active
         ), ranked as materialized (
           select o.asset_id, o.date, o.close, o.high, o.volume,
                  row_number() over(partition by o.asset_id order by o.date desc) rn
             from public.daily_ohlcv o
             join universe u on u.id = o.asset_id
            where o.date >= $3::date - interval '420 days'
              and o.date < $2::date
         ), stats as materialized (
           select r.asset_id,
                  u.armed_eligible,
                  max(r.date) filter(where r.rn = 1) as latest_date,
                  max(r.close) filter(where r.rn = 1) as last_close,
                  count(*) filter(where r.rn <= 200)::integer as history_count_200,
                  count(*) filter(where r.rn <= 253)::integer as history_count_253,
                  avg(r.close) filter(where r.rn <= 20) as sma20,
                  avg(r.close) filter(where r.rn <= 50) as sma50,
                  avg(r.close) filter(where r.rn <= 200) as sma200,
                  max(r.high) filter(where r.rn <= 20) as high20,
                  avg(r.close * r.volume) filter(where r.rn <= 20) as traded_value20,
                  max(r.close) filter(where r.rn = 22) as c21,
                  max(r.close) filter(where r.rn = 64) as c63,
                  max(r.close) filter(where r.rn = 127) as c126,
                  max(r.close) filter(where r.rn = 190) as c189,
                  max(r.close) filter(where r.rn = 253) as c252,
                  (
                    count(*) filter(where r.rn <= 22 and r.date >= $3::date - interval '60 days') = 22
                    and max(r.close) filter(where r.rn = 1) > max(r.high) filter(where r.rn between 3 and 22)
                    and max(r.close) filter(where r.rn = 2) > max(r.high) filter(where r.rn between 3 and 22)
                  ) as two_close_hold
             from ranked r
             join universe u on u.id = r.asset_id
            where r.rn <= 253
            group by r.asset_id, u.armed_eligible
         ), armed_rs as (
           select asset_id,
                  100 * percent_rank() over(order by
                    0.4 * (last_close / c63 - 1)
                    + 0.2 * (last_close / c126 - 1)
                    + 0.2 * (last_close / c189 - 1)
                    + 0.2 * (last_close / c252 - 1)
                  ) as armed_rs_percentile
             from stats
            where armed_eligible and c252 > 0 and c189 > 0 and c126 > 0 and c63 > 0
         ), written as (
           insert into public.eod_asset_features (
             asset_id, market, latest_date, last_close,
             history_count_200, history_count_253,
             sma20, sma50, sma200, high20, traded_value20,
             c21, c63, c126, c189, c252,
             armed_rs_percentile, two_close_hold, refreshed_at
           )
           select s.asset_id, $1, s.latest_date, s.last_close,
                  s.history_count_200, s.history_count_253,
                  s.sma20, s.sma50, s.sma200, s.high20, s.traded_value20,
                  s.c21, s.c63, s.c126, s.c189, s.c252,
                  rs.armed_rs_percentile, coalesce(s.two_close_hold, false), now()
             from stats s
             left join armed_rs rs on rs.asset_id = s.asset_id
            where s.latest_date is not null and s.last_close is not null
           returning latest_date
         )
         select count(*)::text as row_count, max(latest_date)::text as latest_bar_date from written`,
        [market, cutoffDate, sessionDate],
      );
      const rowCount = Number(inserted.rows[0]?.row_count ?? 0);
      const latestBarDate = inserted.rows[0]?.latest_bar_date?.slice(0, 10) ?? null;
      if (!latestBarDate || rowCount === 0) return null;
      const metaRes = await client.query<{ refreshed_at: string }>(
        `insert into public.eod_asset_features_meta (market, cutoff_date, latest_bar_date, row_count, refreshed_at)
         values ($1, $2::date, $3::date, $4, now())
         on conflict (market) do update set
           cutoff_date = excluded.cutoff_date,
           latest_bar_date = excluded.latest_bar_date,
           row_count = excluded.row_count,
           refreshed_at = now()
         returning refreshed_at::text`,
        [market, cutoffDate, latestBarDate, rowCount],
      );
      return {
        market,
        cutoffDate,
        latestBarDate,
        rowCount,
        refreshedAt: metaRes.rows[0]?.refreshed_at ?? new Date().toISOString(),
      };
    });
    state.meta.set(market, { at: Date.now(), meta });
    return meta;
  })().finally(() => {
    state.inflight.delete(key);
  });

  state.inflight.set(key, run);
  return run;
}

const RECENT_DELAYED_EOD_MS = 15 * 60_000;

function cutoffMatches(
  meta: Pick<EodFeaturesMeta, "cutoffDate" | "latestBarDate" | "rowCount"> | null,
  marketOpen: boolean,
  sessionDate: string,
): boolean {
  if (!meta || meta.rowCount <= 0) return false;
  if (marketOpen) return meta.cutoffDate <= sessionDate || meta.latestBarDate < sessionDate;
  return meta.cutoffDate <= nextCalendarDate(sessionDate);
}

/**
 * Ensure `public.eod_asset_features` is fresh for the current session.
 * Returns `true` when readers can safely query `eod_asset_features` with zero parity drift,
 * or `false` if callers should fall back to scanning `daily_ohlcv` directly.
 */
export async function ensureEodAssetFeaturesReady(
  market: "IN" | "US",
  marketOpen: boolean,
  sessionDate: string,
  expectedSession: string,
): Promise<boolean> {
  try {
    const meta = await readMeta(market);
    if (isEodFeaturesFresh(meta, { marketOpen, sessionDate, expectedSession })) return true;
    // When EOD data is delayed past 18:30 IST / 17:00 ET, daily_ohlcv itself still ends on
    // the prior session; avoid rebuilding every 30s if we just refreshed for this cutoff.
    if (
      meta
      && cutoffMatches(meta, marketOpen, sessionDate)
      && Number.isFinite(Date.parse(meta.refreshedAt))
      && Date.now() - Date.parse(meta.refreshedAt) < RECENT_DELAYED_EOD_MS
    ) {
      return true;
    }
    const refreshed = await refreshEodAssetFeatures(market, { marketOpen, sessionDate });
    return cutoffMatches(refreshed, marketOpen, sessionDate);
  } catch (error) {
    console.warn(`[eod-features] falling back to live daily_ohlcv scan for ${market}:`, error instanceof Error ? error.message : error);
    return false;
  }
}
