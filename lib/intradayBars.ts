// One-minute candles for India cash stocks, read from stored bars only. Live
// bars are built from ticks and marked provisional until the after-close sync
// replaces them with the broker's own candles. Nothing here feeds a signal.
import { query } from "@/lib/db";

import type { IntradaySeries } from "@/lib/intradayAggregate";

export const MAX_INTRADAY_SESSIONS = 5;

export async function getIntradayBars(
  ticker: string,
  exchange?: string | null,
  sessions = 1,
): Promise<IntradaySeries | null> {
  const wanted = String(ticker).trim().toUpperCase();
  if (!wanted) return null;
  const preferred = String(exchange ?? "").trim().toUpperCase() === "BSE" ? "BSE" : "NSE";
  const sessionCount = Math.max(1, Math.min(MAX_INTRADAY_SESSIONS, Math.round(sessions) || 1));

  const rows = await query<{
    ticker: string; exchange: string; bar_time: Date | string;
    open: string; high: string; low: string; close: string; volume: string | null; source: string;
  }>(
    `with picked as (
       select a.id, a.ticker, a.exchange
         from public.assets a
        where a.country='IN' and a.exchange in ('NSE','BSE') and a.asset_class='STOCK' and a.is_active
          and upper(a.ticker)=$1
        order by case when a.exchange=$2 then 0 else 1 end, a.created_at
        limit 1
     ), days as (
       select distinct (b.bar_time at time zone 'Asia/Kolkata')::date d
         from public.intraday_bars b join picked p on p.id=b.asset_id
        order by d desc limit $3
     )
     select p.ticker, p.exchange, b.bar_time, b.open, b.high, b.low, b.close, b.volume, b.source
       from public.intraday_bars b join picked p on p.id=b.asset_id
      where (b.bar_time at time zone 'Asia/Kolkata')::date >= (select min(d) from days)
      order by b.bar_time`,
    [wanted, preferred, sessionCount],
  );
  if (!rows.length) return null;
  return {
    ticker: rows[0].ticker,
    exchange: rows[0].exchange,
    provisional: rows.some((row) => row.source !== "BREEZE_HISTORICAL"),
    bars: rows.map((row) => ({
      time: Math.floor(new Date(row.bar_time).getTime() / 1000),
      open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
      volume: row.volume === null ? null : Number(row.volume),
    })),
  };
}
