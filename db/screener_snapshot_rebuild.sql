-- Canonical screener snapshot rebuild (used by scripts/refresh-screener.mjs).
-- Mirrors REBUILD_SQL in lib/screener/snapshot.ts (the app/cron path). Parameter
-- $1 = country ('US' | 'IN') or NULL for both. The caller handles the preceding
-- truncate/delete so this is a pure INSERT ... SELECT.
with bars as (
  select asset_id, date, open, high, low, close, volume,
         row_number() over (partition by asset_id order by date desc) as rn
  from public.daily_ohlcv
  where date >= (current_date - interval '400 days')
),
latest as (select * from bars where rn = 1),
prev   as (select asset_id, close as prev_close from bars where rn = 2),
win as (
  select asset_id, max(high) as high_52w, min(low) as low_52w
  from public.daily_ohlcv
  where date >= (current_date - interval '1 year')
  group by asset_id
),
latest_tech as (
  select distinct on (asset_id) * from public.screener_technical_daily order by asset_id,date desc
),
ranked as (
  select
    a.id as asset_id, a.ticker as symbol, a.name, a.sector, a.country, a.exchange, a.currency,
    coalesce(q.price, l.close) as ltp,
    coalesce(q.change_pct, case when p.prev_close > 0 then (l.close - p.prev_close) / p.prev_close * 100 end) as change_pct_1d,
    l.volume,
    coalesce(q.price, l.close) * l.volume
      / (case when a.currency = 'USD' then 1000000 else 10000000 end) as trade_value,
    p.prev_close, l.open as day_open, l.high as day_high, l.low as day_low,
    w.high_52w, w.low_52w,
    case when w.high_52w > 0 then (coalesce(q.price, l.close) - w.high_52w) / w.high_52w * 100 end as pct_from_52w_high,
    case when w.low_52w  > 0 then (coalesce(q.price, l.close) - w.low_52w)  / w.low_52w  * 100 end as pct_from_52w_low,
    case when p.prev_close > 0 then (l.open - p.prev_close) / p.prev_close * 100 end as gap_pct,
    case when coalesce(p.prev_close, l.close) > 0 then (l.high - l.low) / coalesce(p.prev_close, l.close) * 100 end as intraday_vol_pct,
    f.market_cap, f.pe_ratio, f.roe, f.roce, f.debt_to_equity, f.dividend_yield, f.free_cash_flow,
    f.sales_variance_yoy as revenue_growth_yoy, f.profit_variance_yoy as profit_growth_yoy,
    t.sma_20,t.sma_50,t.sma_100,t.sma_150,t.sma_200,t.ema_20,t.ema_50,
    t.distance_sma_20_pct,t.distance_sma_50_pct,t.distance_sma_100_pct,t.distance_sma_150_pct,t.distance_sma_200_pct,
    t.distance_ema_20_pct,t.distance_ema_50_pct,
    t.sma_20_vs_50_pct,t.sma_20_vs_100_pct,t.sma_20_vs_150_pct,t.sma_20_vs_200_pct,
    t.sma_50_vs_100_pct,t.sma_50_vs_150_pct,t.sma_50_vs_200_pct,
    t.sma_100_vs_150_pct,t.sma_100_vs_200_pct,t.sma_150_vs_200_pct,
    t.rsi_14,t.atr_pct_14,t.volume_ratio_20,
    t.return_5d,t.return_20d,t.return_63d,
    row_number() over (
      partition by a.country, upper(a.ticker)
      order by (w.asset_id is not null) desc, (a.exchange = 'NSE') desc, l.volume desc nulls last, a.created_at asc
    ) as dedup_rn
  from public.assets a
  left join latest l on l.asset_id = a.id
  left join prev p on p.asset_id = a.id
  left join win w on w.asset_id = a.id
  left join public.latest_quotes q on q.asset_id = a.id
  left join public.latest_financials f on f.asset_id = a.id
  left join latest_tech t on t.asset_id = a.id
  where a.asset_class = 'STOCK' and a.is_active
    and ($1::text is null or a.country = $1)
    and (q.asset_id is not null or l.asset_id is not null)
),
deduped as (select * from ranked where dedup_rn = 1)
insert into public.stock_snapshot (
  asset_id, symbol, name, sector, country, exchange, currency,
  ltp, change_pct_1d, volume, trade_value, prev_close, day_open, day_high, day_low,
  high_52w, low_52w, pct_from_52w_high, pct_from_52w_low, gap_pct, intraday_vol_pct,
  market_cap, mcap_rank, pe_ratio, roe, roce, debt_to_equity, dividend_yield, free_cash_flow,
  revenue_growth_yoy, profit_growth_yoy,
  sma_20,sma_50,sma_100,sma_150,sma_200,ema_20,ema_50,
  distance_sma_20_pct,distance_sma_50_pct,distance_sma_100_pct,distance_sma_150_pct,distance_sma_200_pct,
  distance_ema_20_pct,distance_ema_50_pct,
  sma_20_vs_50_pct,sma_20_vs_100_pct,sma_20_vs_150_pct,sma_20_vs_200_pct,
  sma_50_vs_100_pct,sma_50_vs_150_pct,sma_50_vs_200_pct,sma_100_vs_150_pct,sma_100_vs_200_pct,sma_150_vs_200_pct,
  rsi_14,atr_pct_14,volume_ratio_20,return_5d,return_20d,return_63d,refreshed_at
)
select
  asset_id, symbol, name, sector, country, exchange, currency,
  ltp, change_pct_1d, volume, trade_value, prev_close, day_open, day_high, day_low,
  high_52w, low_52w, pct_from_52w_high, pct_from_52w_low, gap_pct, intraday_vol_pct,
  market_cap,
  case when market_cap is not null then rank() over (partition by country order by market_cap desc nulls last)::int end,
  pe_ratio, roe, roce, debt_to_equity, dividend_yield, free_cash_flow,
  revenue_growth_yoy, profit_growth_yoy,
  sma_20,sma_50,sma_100,sma_150,sma_200,ema_20,ema_50,
  distance_sma_20_pct,distance_sma_50_pct,distance_sma_100_pct,distance_sma_150_pct,distance_sma_200_pct,
  distance_ema_20_pct,distance_ema_50_pct,
  sma_20_vs_50_pct,sma_20_vs_100_pct,sma_20_vs_150_pct,sma_20_vs_200_pct,
  sma_50_vs_100_pct,sma_50_vs_150_pct,sma_50_vs_200_pct,sma_100_vs_150_pct,sma_100_vs_200_pct,sma_150_vs_200_pct,
  rsi_14,atr_pct_14,volume_ratio_20,return_5d,return_20d,return_63d,now()
from deduped;
