import { query } from "@/lib/db";
import type { MarketId } from "@/lib/types";

/**
 * What the strategy has actually done, for the screen that asks you to buy.
 *
 * Until now nothing on the Strong Swing page said whether a Strong Swing signal has
 * ever worked, so the only thing a reader could weigh was the gates agreeing with
 * themselves. These numbers come from `strong_swing_replay_signals`: the engine
 * replayed over recorded history and graded by entering at the next session's open.
 *
 * Every figure is computed in SQL over outcomes Python produced. Nothing here
 * recalculates a strategy result in TypeScript.
 */
export type StrategyRecord = {
  trades: number;
  winRatePct: number;
  expectancyPct: number;
  medianPct: number;
  averageWinPct: number;
  averageLossPct: number;
  targetHits: number;
  stopHits: number;
  fromYear: number;
  toYear: number;
  horizonSessions: number;
  /** Gates the replay could not judge, so the screen can say so instead of implying it did. */
  resultsEvaluated: boolean;
  liveExecutionEvaluated: boolean;
  modelVersion: string;
  /** The most recent full-ish year on its own: a decade average hides the current regime. */
  latestYear: { year: number; trades: number; expectancyPct: number } | null;
};

type RecordRow = {
  trades: string;
  win_rate_pct: string | null;
  expectancy_pct: string | null;
  median_pct: string | null;
  average_win_pct: string | null;
  average_loss_pct: string | null;
  target_hits: string;
  stop_hits: string;
  from_year: string;
  to_year: string;
  horizon_sessions: number;
  results_mode: string;
  live_execution_evaluated: boolean;
  model_version: string;
  latest_year: string | null;
  latest_year_trades: string | null;
  latest_year_expectancy_pct: string | null;
};

const number = (value: string | null): number => (value === null ? 0 : Number(value));

export async function loadStrategyRecord(market: MarketId): Promise<StrategyRecord | null> {
  const rows = await query<RecordRow>(
    `with run as (
       select id,horizon_sessions,results_mode,live_execution_evaluated,model_version
         from public.strong_swing_replay_runs
        where market=$1 order by created_at desc limit 1
     ), graded as (
       select s.return_pct,s.exit_reason,
              extract(year from s.signal_date)::int as year
         from public.strong_swing_replay_signals s join run on run.id=s.run_id
        where s.return_pct is not null
     ), latest as (
       select year,count(*) trades,avg(return_pct) expectancy
         from graded group by year order by year desc limit 1
     )
     select count(*)::text trades,
            (avg(case when g.return_pct > 0 then 100.0 else 0 end))::text win_rate_pct,
            avg(g.return_pct)::text expectancy_pct,
            (percentile_cont(0.5) within group (order by g.return_pct))::text median_pct,
            avg(g.return_pct) filter (where g.return_pct > 0)::text average_win_pct,
            avg(g.return_pct) filter (where g.return_pct <= 0)::text average_loss_pct,
            count(*) filter (where g.exit_reason='TARGET')::text target_hits,
            count(*) filter (where g.exit_reason='STOP')::text stop_hits,
            min(g.year)::text from_year, max(g.year)::text to_year,
            run.horizon_sessions,run.results_mode,run.live_execution_evaluated,run.model_version,
            (select year from latest)::text latest_year,
            (select trades from latest)::text latest_year_trades,
            (select expectancy from latest)::text latest_year_expectancy_pct
       from graded g cross join run
      group by run.horizon_sessions,run.results_mode,run.live_execution_evaluated,run.model_version`,
    [market],
  ).catch((error: { code?: string }) => {
    // The replay tables arrive with migration 0082. A deployment that has not run it
    // yet should show no record rather than fail the whole screen.
    if (error.code === "42P01") return [] as RecordRow[];
    throw error;
  });

  const row = rows[0];
  if (!row || Number(row.trades) === 0) return null;
  return {
    trades: Number(row.trades),
    winRatePct: number(row.win_rate_pct),
    expectancyPct: number(row.expectancy_pct),
    medianPct: number(row.median_pct),
    averageWinPct: number(row.average_win_pct),
    averageLossPct: number(row.average_loss_pct),
    targetHits: Number(row.target_hits),
    stopHits: Number(row.stop_hits),
    fromYear: Number(row.from_year),
    toYear: Number(row.to_year),
    horizonSessions: row.horizon_sessions,
    resultsEvaluated: row.results_mode === "strict",
    liveExecutionEvaluated: row.live_execution_evaluated,
    modelVersion: row.model_version,
    latestYear: row.latest_year === null ? null : {
      year: Number(row.latest_year),
      trades: number(row.latest_year_trades),
      expectancyPct: number(row.latest_year_expectancy_pct),
    },
  };
}
