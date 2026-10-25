import { query } from "@/lib/db";
import { FIELD_BY_KEY } from "./fields";
import { toSqlWhere, validateFilter, type Filter } from "./filterEngine";
import type { Market } from "./service";

export interface BacktestHorizon {
  sessions: 5 | 20 | 60;
  observations: number;
  averageReturnPct: number | null;
  medianReturnPct: number | null;
  positiveRatePct: number | null;
  baselineAverageReturnPct: number | null;
}
export interface ScreenerBacktestResult {
  years: number;
  sampled: "LAST_SESSION_EACH_WEEK";
  horizons: BacktestHorizon[];
  warning: string | null;
}

export async function runTechnicalBacktest(input: {
  market: Market; universe?: string; filters: Filter[]; years: number;
}): Promise<ScreenerBacktestResult> {
  const years = Math.max(1, Math.min(5, Math.round(input.years)));
  for (const filter of input.filters) {
    validateFilter(filter);
    if (!FIELD_BY_KEY[filter.field]?.historical) {
      throw new Error(`${FIELD_BY_KEY[filter.field]?.label ?? filter.field} has no point-in-time history and cannot be backtested safely.`);
    }
  }
  if (!input.filters.length) throw new Error("Add at least one historical technical condition before backtesting.");

  const params: unknown[] = [input.market, years];
  let universeJoin = "";
  if (input.universe && input.universe !== "ALL") {
    params.push(input.universe);
    universeJoin = `join public.universe_members u on u.asset_id=d.asset_id and u.universe=$${params.length}`;
  }
  const built = toSqlWhere(input.filters, params.length + 1);
  params.push(...built.params);
  const clauses = built.clauses.map((clause) => clause.replaceAll("s.", "d."));
  const rows = await query<Record<string, string | number | null>>(
    `with eligible as (
       select d.*,row_number() over(partition by d.asset_id,date_trunc('week',d.date) order by d.date desc) weekly_rank
       from public.screener_technical_daily d
       join public.assets a on a.id=d.asset_id
       ${universeJoin}
       where a.country=$1 and d.date >= current_date - ($2::int * interval '1 year')
     ), matched as (
       select * from eligible d where weekly_rank=1 and ${clauses.join(" and ")}
     ), outcomes as (
       select 5 sessions,forward_return_5d value from matched
       union all select 20,forward_return_20d from matched
       union all select 60,forward_return_60d from matched
     ), baseline as (
       select 5 sessions,forward_return_5d value from eligible where weekly_rank=1
       union all select 20,forward_return_20d from eligible where weekly_rank=1
       union all select 60,forward_return_60d from eligible where weekly_rank=1
     )
     select o.sessions,count(o.value)::int observations,avg(o.value) average_return,
            percentile_cont(0.5) within group(order by o.value) median_return,
            avg(case when o.value>0 then 100.0 else 0 end) positive_rate,
            (select avg(b.value) from baseline b where b.sessions=o.sessions) baseline_average
       from outcomes o where o.value is not null group by o.sessions order by o.sessions`,
    params,
  );
  const horizons = rows.map((row) => ({
    sessions: Number(row.sessions) as 5 | 20 | 60,
    observations: Number(row.observations),
    averageReturnPct: row.average_return === null ? null : Number(row.average_return),
    medianReturnPct: row.median_return === null ? null : Number(row.median_return),
    positiveRatePct: row.positive_rate === null ? null : Number(row.positive_rate),
    baselineAverageReturnPct: row.baseline_average === null ? null : Number(row.baseline_average),
  }));
  return {
    years, sampled: "LAST_SESSION_EACH_WEEK", horizons,
    warning: input.universe && input.universe !== "ALL"
      ? "Universe membership is the current constituent list; historical membership is not yet available, so survivorship bias may remain."
      : null,
  };
}
