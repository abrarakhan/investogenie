/** Bars a benchmark needs before its 50-session regime (and 20-session lookback) is reliable. */
export const BENCHMARK_MIN_HISTORY = 200;

/**
 * SQL selecting the one benchmark asset every engine compares against.
 *
 * Preference order alone is not enough: the India `NIFTY` index series only
 * started recently, and choosing it left the 50-session market-regime check
 * permanently unreachable. A candidate with sufficient, current history
 * (`NIFTYBEES` today) now wins. Among equally qualified (or equally
 * unqualified) candidates the listed preference order decides, and total
 * history length only breaks a tie between two assets with the same ticker.
 */
export function chosenBenchmarkSql(countryParam: string, tickersParam: string): string {
  // Freshness is measured against the market's own newest stock bar, not against the wall
  // clock. `current_date - 7` accepted a benchmark up to seven calendar days old, while the
  // engines require the benchmark to be within one trading session of the stocks they are
  // screening. The two definitions disagreed, so the selector could return a benchmark the
  // freshness gate then rejected — which is what happened when BSE ingestion stalled four
  // sessions behind NSE and the India screen chose a BSE benchmark it could not use.
  // The lag is counted in trading sessions actually present in the data, not in calendar days:
  // a four-calendar-day gap is one session over a long weekend but four sessions mid-week, so
  // no fixed number of days expresses "within one session".
  return `with market_latest as (
            select max(o.date) as latest
              from public.daily_ohlcv o
              join public.assets a on a.id=o.asset_id
             where a.country=${countryParam} and a.asset_class='STOCK' and a.is_active
          ),
          candidate as (
            select a.id, a.ticker,
                   (select count(*) from public.daily_ohlcv o where o.asset_id=a.id) as bars,
                   (select max(o.date) from public.daily_ohlcv o where o.asset_id=a.id) as latest
              from public.assets a
             where a.country=${countryParam} and a.ticker=any(${tickersParam}::text[])
          )
          select candidate.id from candidate
          order by (candidate.bars >= ${BENCHMARK_MIN_HISTORY}
                      and (select count(distinct o.date)
                             from public.daily_ohlcv o
                             join public.assets a2 on a2.id=o.asset_id
                            where a2.country=${countryParam} and a2.asset_class='STOCK' and a2.is_active
                              and o.date > candidate.latest
                              and o.date <= (select latest from market_latest)) <= 1
                   ) desc nulls last,
                   array_position(${tickersParam}::text[],candidate.ticker),
                   candidate.bars desc
          limit 1`;
}
