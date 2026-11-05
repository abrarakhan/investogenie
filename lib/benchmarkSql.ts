/** Bars a benchmark needs before its 50-session regime (and 20-session lookback) is reliable. */
export const BENCHMARK_MIN_HISTORY = 200;

/**
 * SQL selecting the one benchmark asset every engine compares against.
 *
 * Preference order alone is not enough: the India `NIFTY` index series only
 * started recently, and choosing it left the 50-session market-regime check
 * permanently unreachable. A candidate with sufficient, current history
 * (`NIFTYBEES` today) now wins; preference order only breaks ties, and the
 * longest history remains the last resort when nothing qualifies.
 */
export function chosenBenchmarkSql(countryParam: string, tickersParam: string): string {
  return `select a.id from public.assets a
          where a.country=${countryParam} and a.ticker=any(${tickersParam}::text[])
          order by (select count(*) >= ${BENCHMARK_MIN_HISTORY} and max(o.date) >= current_date - 7
                      from public.daily_ohlcv o
                     where o.asset_id=a.id and o.date >= current_date - 400) desc nulls last,
                   array_position(${tickersParam}::text[],a.ticker),
                   (select count(*) from public.daily_ohlcv o where o.asset_id=a.id) desc
          limit 1`;
}
