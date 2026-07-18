// Screener snapshot builder. Rebuilds public.stock_snapshot — the materialised
// read model the screener queries — from live quotes, the last ~400 days of
// daily_ohlcv bars, and latest_financials. Run on a schedule (default every
// 15 min during IST market hours) via /api/cron/refresh-screener, or on demand
// with scripts/refresh-screener.mjs.
//
// Price-action fields (52w high/low, gap, intraday volatility, trade value) are
// derived here from OHLC history; fundamentals are carried straight through from
// latest_financials (populated by the yfinance pipelines). Everything is
// nullable except identity columns — a stock with no fundamentals still shows up
// price-only, and NULLs render as "—" and are excluded from numeric filters.

import { tx } from "@/lib/db";

export interface SnapshotResult {
  count: number;
  durationMs: number;
}

// One statement, wrapped in a transaction with the delete so readers never see
// a half-built table. `country` null rebuilds both markets.
//
// Dedup: a company can be listed on more than one exchange (RELIANCE on NSE and
// BSE, a US name on NASDAQ and OTC). We keep exactly one row per
// (country, symbol) — the richest: OHLC history first, then NSE, then higher
// volume. mcap_rank is computed AFTER dedup so dual listings don't distort the
// SEBI cap bands.
const REBUILD_SQL = `
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
ranked as (
  select
    a.id as asset_id, a.ticker as symbol, a.name, a.sector, a.country, a.exchange, a.currency,
    coalesce(q.price, l.close)                                             as ltp,
    coalesce(q.change_pct,
             case when p.prev_close > 0 then (l.close - p.prev_close) / p.prev_close * 100 end) as change_pct_1d,
    l.volume,
    coalesce(q.price, l.close) * l.volume
      / (case when a.currency = 'USD' then 1000000 else 10000000 end)      as trade_value,
    p.prev_close, l.open as day_open, l.high as day_high, l.low as day_low,
    w.high_52w, w.low_52w,
    case when w.high_52w > 0 then (coalesce(q.price, l.close) - w.high_52w) / w.high_52w * 100 end as pct_from_52w_high,
    case when w.low_52w  > 0 then (coalesce(q.price, l.close) - w.low_52w)  / w.low_52w  * 100 end as pct_from_52w_low,
    case when p.prev_close > 0 then (l.open - p.prev_close) / p.prev_close * 100 end               as gap_pct,
    case when coalesce(p.prev_close, l.close) > 0
         then (l.high - l.low) / coalesce(p.prev_close, l.close) * 100 end                         as intraday_vol_pct,
    f.market_cap, f.pe_ratio, f.roe, f.roce, f.debt_to_equity, f.dividend_yield, f.free_cash_flow,
    f.sales_variance_yoy  as revenue_growth_yoy,
    f.profit_variance_yoy as profit_growth_yoy,
    row_number() over (
      partition by a.country, upper(a.ticker)
      order by (w.asset_id is not null) desc,   -- has 52w / OHLC history first
               (a.exchange = 'NSE') desc,        -- prefer NSE over BSE dual listings
               l.volume desc nulls last,
               a.created_at asc
    ) as dedup_rn
  from public.assets a
  left join latest l                    on l.asset_id = a.id
  left join prev p                      on p.asset_id = a.id
  left join win w                       on w.asset_id = a.id
  left join public.latest_quotes q      on q.asset_id = a.id
  left join public.latest_financials f  on f.asset_id = a.id
  where a.asset_class = 'STOCK'
    and a.is_active
    and ($1::text is null or a.country = $1)
    and (q.asset_id is not null or l.asset_id is not null)
),
deduped as (select * from ranked where dedup_rn = 1)
insert into public.stock_snapshot (
  asset_id, symbol, name, sector, country, exchange, currency,
  ltp, change_pct_1d, volume, trade_value, prev_close, day_open, day_high, day_low,
  high_52w, low_52w, pct_from_52w_high, pct_from_52w_low, gap_pct, intraday_vol_pct,
  market_cap, mcap_rank, pe_ratio, roe, roce, debt_to_equity, dividend_yield, free_cash_flow,
  revenue_growth_yoy, profit_growth_yoy, refreshed_at
)
select
  asset_id, symbol, name, sector, country, exchange, currency,
  ltp, change_pct_1d, volume, trade_value, prev_close, day_open, day_high, day_low,
  high_52w, low_52w, pct_from_52w_high, pct_from_52w_low, gap_pct, intraday_vol_pct,
  market_cap,
  case when market_cap is not null
       then rank() over (partition by country order by market_cap desc nulls last)::int end as mcap_rank,
  pe_ratio, roe, roce, debt_to_equity, dividend_yield, free_cash_flow,
  revenue_growth_yoy, profit_growth_yoy, now()
from deduped
`;

/**
 * Rebuild the screener snapshot. Pass a country ('US' | 'IN') to rebuild just
 * that market, or nothing to rebuild both. Atomic: the delete + insert run in
 * one transaction so concurrent reads always see a complete table.
 */
export async function refreshStockSnapshot(country?: "US" | "IN"): Promise<SnapshotResult> {
  const t0 = Date.now();
  const count = await tx(async (c) => {
    if (country) {
      await c.query("delete from public.stock_snapshot where country = $1", [country]);
    } else {
      await c.query("truncate public.stock_snapshot");
    }
    const res = await c.query(REBUILD_SQL, [country ?? null]);
    return res.rowCount ?? 0;
  });
  return { count, durationMs: Date.now() - t0 };
}
