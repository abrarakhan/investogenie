import { query } from "@/lib/db";

export type CandidateSignalEngine = "STRONG_SWING" | "MOMENTUM_IGNITION" | "MOMENTUM_IGNITION_V2" | "TREND_CONTINUATION";

export interface ReadySignalHistoryRow {
  assetId: string;
  ticker: string;
  engine: CandidateSignalEngine;
  firstReadyAt: string;
  firstReadyStatus: string;
  latestStatus: string;
  currentlyReady: boolean;
}

/**
 * Preserve intraday readiness transitions for the screen. A live classifier is
 * allowed to move on as price/volume change, but the user must still be able to
 * see when a stock first became actionable earlier in the same market day.
 */
export async function getTodayReadySignalHistory(
  userId: string,
  market: "IN" | "US",
): Promise<ReadySignalHistoryRow[]> {
  const rows = await query<{
    asset_id: string; ticker: string; engine: CandidateSignalEngine;
    first_ready_at: string; first_ready_status: string; latest_status: string; currently_ready: boolean;
  }>(
    `with todays as materialized (
       select o.*
         from public.candidate_signal_observations o
        where o.user_id=$1 and o.market=$2
          and (o.observed_at at time zone case when $2='IN' then 'Asia/Kolkata' else 'America/New_York' end)::date
            = (now() at time zone case when $2='IN' then 'Asia/Kolkata' else 'America/New_York' end)::date
     ), first_ready as (
       select distinct on (engine,asset_id) engine,asset_id,status,observed_at
         from todays where ready
        order by engine,asset_id,observed_at
     ), latest as (
       select distinct on (engine,asset_id) engine,asset_id,status,ready
         from todays
        order by engine,asset_id,observed_at desc
     )
     select f.asset_id,a.ticker,f.engine,f.observed_at::text first_ready_at,
            f.status first_ready_status,
            case when coalesce(s.was_ready,false) then coalesce(s.last_status,l.status)
                 when coalesce(s.last_status,l.status)=f.status then 'NO_LONGER_READY'
                 else coalesce(s.last_status,l.status) end latest_status,
            coalesce(s.was_ready,false) currently_ready
       from first_ready f join latest l using(engine,asset_id)
       join public.assets a on a.id=f.asset_id
       left join public.mobile_candidate_alert_state s
         on s.user_id=$1 and s.market=$2 and s.engine=f.engine and s.asset_id=f.asset_id
      order by f.observed_at desc,a.ticker`,
    [userId, market],
  );
  return rows.map((row) => ({
    assetId: row.asset_id,
    ticker: row.ticker,
    engine: row.engine,
    firstReadyAt: row.first_ready_at,
    firstReadyStatus: row.first_ready_status,
    latestStatus: row.latest_status,
    currentlyReady: row.currently_ready,
  }));
}
