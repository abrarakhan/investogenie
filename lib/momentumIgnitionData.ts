import { cache } from "react";
import { query } from "@/lib/db";

export interface MomentumPreliminaryRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string;
  current_price: string | number;
  quote_change_pct: string | number | null;
  quote_as_of: string;
  latest_date: string;
  base_score: string | number | null;
  base_verdict: string | null;
  strong_status: string | null;
  strong_captured_at: string | null;
}

export interface MomentumBarRow {
  asset_id: string;
  date: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  open_interest: string | number | null;
}

const preliminarySql = (market: "IN" | "US") => {
  const universe = market === "IN"
    ? "a.country='IN' and a.exchange='NSE'"
    : "a.country='US' and a.exchange in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN')";
  return `
  with universe as materialized (
    select a.id,a.ticker,a.name,a.exchange
      from public.assets a
     where ${universe} and a.asset_class='STOCK'
       and a.is_active
       and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)
  ), ranked as materialized (
    select o.asset_id,o.date,o.close,o.high,o.volume,
           row_number() over(partition by o.asset_id order by o.date desc) rn
      from public.daily_ohlcv o join universe u on u.id=o.asset_id
     where o.date >= current_date - interval '420 days'
  ), stats as (
    select asset_id,count(*) filter(where rn<=200) history_count,
           max(date) filter(where rn=1) latest_date,max(close) filter(where rn=1) last_close,
           avg(close) filter(where rn<=20) sma20,avg(close) filter(where rn<=50) sma50,
           avg(close) filter(where rn<=200) sma200,
           max(high) filter(where rn between 2 and 21) breakout_level,
           avg(close*volume) filter(where rn between 2 and 21) traded_value20
      from ranked where rn<=220 group by asset_id
  )
  select u.id asset_id,u.ticker,u.name,u.exchange,
         q.price current_price,q.change_pct quote_change_pct,q.as_of::text quote_as_of,
         st.latest_date::text latest_date,s.score base_score,s.verdict base_verdict,
         strong.status strong_status,strong.captured_at::text strong_captured_at
    from universe u join stats st on st.asset_id=u.id
    join public.latest_quotes q on q.asset_id=u.id
    left join public.swing_signals s on s.asset_id=u.id
    left join lateral (
      select ss.status,ss.captured_at from public.strong_swing_snapshots ss
       where ss.asset_id=u.id and ss.market=$5 and ss.latest_bar_date >= $1::date
       order by ss.captured_at desc limit 1
    ) strong on true
   where st.history_count>=10 and q.price>=$3
     and ((st.history_count>=200 and q.price>st.sma20 and st.sma20>st.sma50 and st.sma50>st.sma200)
       or (st.history_count<200 and q.price>st.sma20))
     and q.price>=st.breakout_level*0.90 and st.traded_value20>=$4
     and st.latest_date >= $1::date and q.as_of::date >= $1::date
     and (not $2::boolean or q.updated_at >= now() - interval '7 minutes')
   order by case when q.price>=st.breakout_level then 0 else 1 end,
     abs((q.price/st.breakout_level)-1),coalesce(s.score,0) desc,u.ticker
   limit 350`;
};

/** Request-scoped reuse for the identical legacy/V2 market scan. */
export const loadMomentumPreliminaryBundle = cache(async (
  market: "IN" | "US",
  expectedSessionDate: string,
  marketOpen: boolean,
  priceFloor: number,
  preliminaryLiquidityFloor: number,
  benchmarkTickersKey: string,
) => {
  const universeWhere = market === "IN"
    ? "a.country='IN' and a.exchange='NSE'"
    : "a.country='US' and a.exchange in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN')";
  const benchmarkTickers = JSON.parse(benchmarkTickersKey) as string[];
  const [countRows, preliminary, benchmarkRows] = await Promise.all([
    query<{ count: string | number }>(
      `select count(*) count from public.assets a where ${universeWhere}
        and a.asset_class='STOCK' and a.is_active
        and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)`,
    ),
    query<MomentumPreliminaryRow>(preliminarySql(market), [
      expectedSessionDate, marketOpen, priceFloor, preliminaryLiquidityFloor, market,
    ]),
    query<MomentumBarRow>(
      `with chosen as (
         select a.id from public.assets a where a.country=$1 and a.ticker=any($2::text[])
          order by array_position($2::text[],a.ticker),
                   (select count(*) from public.daily_ohlcv o where o.asset_id=a.id) desc limit 1
       )
       select o.asset_id,o.date::text date,o.open,o.high,o.low,o.close,o.volume,o.open_interest
         from public.daily_ohlcv o join chosen c on c.id=o.asset_id
        order by o.date desc limit 260`,
      [market, benchmarkTickers],
    ),
  ]);
  return { countRows, preliminary, benchmarkRows };
});

/** Request-scoped reuse for the identical 260-bar histories consumed by both models. */
export const loadMomentumBars = cache(async (assetIdsKey: string) => {
  const ids = JSON.parse(assetIdsKey) as string[];
  return query<MomentumBarRow>(
    `select asset_id,date::text date,open,high,low,close,volume,open_interest
       from (
         select o.*,row_number() over(partition by asset_id order by date desc) rn
           from public.daily_ohlcv o where asset_id=any($1::uuid[])
       ) ranked where rn<=260 order by asset_id,date`,
    [ids],
  );
});
