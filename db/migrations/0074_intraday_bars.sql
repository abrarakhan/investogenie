-- One-minute candles for India cash stocks. The live worker builds provisional
-- bars from the ticks it receives (source BREEZE_LIVE_TICKS); after the close a
-- sync replaces the session with Breeze's own candles (source BREEZE_HISTORICAL),
-- which the live worker never overwrites. Only recent sessions are kept.
create table if not exists public.intraday_bars (
  asset_id uuid not null references public.assets(id) on delete cascade,
  bar_time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume bigint,
  source text not null,
  primary key (asset_id, bar_time)
);

-- Rows arrive in time order, so a block-range index stays tiny and is enough
-- for the daily prune of old sessions.
create index if not exists intraday_bars_time_brin
  on public.intraday_bars using brin (bar_time);
