-- Shared completed-bar EOD feature summary table.
-- Materializes the exact completed-session moving averages, 20-day breakout highs,
-- 20-day traded values, IBD relative-strength closes/percentiles, and two-close
-- breakout hold flags once per session so Strong Swing, Momentum Ignition, and
-- Armed Strong Swing avoid repeating 420-day/60-day full-market daily_ohlcv
-- window scans on every page load, keep-warm refresh, and 2-minute alert tick.

create table if not exists public.eod_asset_features (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  market text not null check (market in ('IN', 'US')),
  latest_date date not null,
  last_close numeric not null,
  history_count_200 integer not null,
  history_count_253 integer not null,
  sma20 numeric,
  sma50 numeric,
  sma200 numeric,
  high20 numeric,
  traded_value20 numeric,
  c21 numeric,
  c63 numeric,
  c126 numeric,
  c189 numeric,
  c252 numeric,
  armed_rs_percentile double precision,
  two_close_hold boolean not null default false,
  refreshed_at timestamptz not null default now()
);

create index if not exists idx_eod_asset_features_market_latest
  on public.eod_asset_features (market, latest_date desc);

create index if not exists idx_eod_asset_features_market_hold
  on public.eod_asset_features (market)
  where two_close_hold;

create index if not exists idx_eod_asset_features_market_armed_rs
  on public.eod_asset_features (market, armed_rs_percentile desc nulls last);

create table if not exists public.eod_asset_features_meta (
  market text primary key check (market in ('IN', 'US')),
  cutoff_date date not null,
  latest_bar_date date not null,
  row_count integer not null default 0,
  refreshed_at timestamptz not null default now()
);
