-- Mid-Way Momentum & Institutional Accumulation (v2).
--
-- Adds the deliverable-quantity evidence the mid-way setups rest on, and the
-- per-signal columns that record which trigger path fired so false positives can
-- be audited per variant rather than in aggregate.
--
-- Delivery lives in its own table rather than as columns on daily_ohlcv. That table
-- is keyed by asset_id and carries rows from several sources, including
-- split/dividend-adjusted yfinance history; deliverable quantity is a raw exchange
-- count for one NSE EQ session and does not belong beside adjusted prices. Keying by
-- asset_id rather than symbol is required, not cosmetic: the same ticker exists twice
-- in this database, once for NSE and once for BSE, so (symbol, trade_date) would
-- collide across exchanges.

create table if not exists public.daily_delivery_metrics (
  asset_id uuid not null references public.assets(id) on delete cascade,
  date date not null,
  series text not null,
  deliv_qty bigint,
  deliv_pct numeric(5,2),
  -- Rupees. Bhavcopy reports TURNOVER_LACS; stored here already multiplied out so
  -- every consumer applies the same unit.
  turnover numeric(18,2),
  -- Heuristic, set at ingestion: NSE classes ETFs, REITs and InvITs in series EQ and
  -- assets.asset_class calls them STOCK, so nothing in the data marks them. They
  -- settle at or near 100% delivery by construction and would otherwise read as
  -- maximum institutional conviction on every single session.
  is_etf boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (asset_id, date)
);

comment on table public.daily_delivery_metrics is
  'NSE EQ deliverable quantity and percentage per session, from sec_bhavdata_full. '
  'Series BE/BZ/SM/ST are excluded at ingestion because the exchange enforces 100% '
  'delivery on them, which is a settlement rule rather than accumulation.';

create index if not exists daily_delivery_metrics_date_idx
  on public.daily_delivery_metrics(date);

-- The 20-session rolling delivery baseline is read per asset in date order.
create index if not exists daily_delivery_metrics_asset_date_idx
  on public.daily_delivery_metrics(asset_id, date desc)
  where not is_etf;

-- Which trigger path produced a signal, and the evidence behind it. Typed columns
-- rather than metrics jsonb keys because the screener filters on them.
alter table public.trend_continuation_signals
  add column if not exists setup_variant text,
  add column if not exists deliv_pct numeric(5,2),
  add column if not exists rel_deliv_20d numeric(8,2),
  add column if not exists ibs_close numeric(5,4),
  add column if not exists nifty_alpha_1d numeric(6,2),
  add column if not exists tod_rvol numeric(8,2),
  add column if not exists catalyst_tag text,
  add column if not exists days_since_results integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trend_continuation_signals_setup_variant_check'
  ) then
    alter table public.trend_continuation_signals
      add constraint trend_continuation_signals_setup_variant_check
      check (setup_variant is null or setup_variant in ('STAGE2_IMPULSE','EP_REBOUND','STAIR_STEP'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'trend_continuation_signals_catalyst_tag_check'
  ) then
    alter table public.trend_continuation_signals
      add constraint trend_continuation_signals_catalyst_tag_check
      check (catalyst_tag is null or catalyst_tag in ('EP','TECH'));
  end if;
end $$;

-- The same evidence on the screener's point-in-time feature row, so a user can filter
-- the whole universe on delivery and relative strength without going through a scan.
-- (Migration 0058 named this table screener_technical_daily.)
alter table public.screener_technical_daily
  add column if not exists deliv_pct numeric(5,2),
  add column if not exists rel_deliv_20d numeric(8,2),
  add column if not exists ibs_close numeric(5,4),
  add column if not exists nifty_alpha_1d numeric(6,2),
  add column if not exists setup_variant text,
  add column if not exists catalyst_tag text,
  add column if not exists days_since_results integer;
