-- =============================================================================
-- Stock Screener module.
--
-- Adds the read model + supporting tables for a Kite-style fundamental screener:
--   * assets.sector                       — GICS-ish sector label (yfinance)
--   * asset_financial_reports.{roe, debt_to_equity, dividend_yield,
--     free_cash_flow}                     — fundamentals wired from yfinance .info
--   * latest_financials view              — extended with the four new ratios
--   * public.stock_snapshot               — materialised per-stock screener row,
--                                           refreshed on a schedule (see
--                                           lib/screener/snapshot.ts)
--   * public.universe_members             — Nifty 50/100/500 / F&O membership,
--                                           seeded from db/universes/*.json
--   * public.saved_screens                — per-user saved filter combinations
--
-- Monetary units follow the existing convention: INR figures are Rs. Crore, USD
-- figures are millions. Ratios (roe, roce, dividend_yield) are percent;
-- debt_to_equity is a plain ratio; free_cash_flow is in the report currency's
-- base unit (Rs. Cr / USD mn) as delivered by the provider.
-- =============================================================================

-- --- 1. Sector on the instrument -------------------------------------------
alter table public.assets
  add column if not exists sector text;

create index if not exists assets_sector_idx on public.assets (sector);

-- --- 2. Extra fundamentals on the financial reports ------------------------
alter table public.asset_financial_reports
  add column if not exists roe            numeric(12, 4),   -- return on equity, %
  add column if not exists debt_to_equity numeric(12, 4),   -- total debt / equity
  add column if not exists dividend_yield numeric(10, 4),   -- %
  add column if not exists free_cash_flow numeric(20, 2);   -- Rs. Cr / USD mn

-- Rebuild the latest-snapshot view to carry the new ratios through to reads.
-- Dropped + recreated (not create-or-replace) because the new columns are
-- interleaved with the existing ones, which a replace would read as a rename.
drop view if exists public.latest_financials;
create view public.latest_financials as
  select distinct on (asset_id)
    asset_id, period_end_date, report_type, fiscal_period, currency,
    revenue, net_profit, eps, cmp, pe_ratio, market_cap, roce,
    roe, debt_to_equity, dividend_yield, free_cash_flow,
    profit_variance_yoy, sales_variance_yoy
  from public.asset_financial_reports
  where report_type = 'QUARTERLY'
  order by asset_id, period_end_date desc;

-- --- 3. Screener read model (materialised snapshot) ------------------------
-- One row per tracked stock. Rebuilt by the refresh job from live quotes,
-- the latest OHLC bars, and latest_financials. Nullable everywhere except the
-- identity columns: a stock with no fundamentals still appears (price-only).
create table if not exists public.stock_snapshot (
  asset_id            uuid    primary key references public.assets (id) on delete cascade,
  symbol              text    not null,
  name                text,
  sector              text,
  country             text    not null,
  exchange            text    not null,
  currency            text    not null,

  -- Price action (from latest_quotes + the last two daily_ohlcv bars).
  ltp                 numeric(20, 4),
  change_pct_1d       numeric(12, 4),
  volume              bigint,
  trade_value         numeric(24, 2),   -- ltp * volume, quote currency
  prev_close          numeric(20, 4),
  day_open            numeric(20, 4),
  day_high            numeric(20, 4),
  day_low             numeric(20, 4),
  high_52w            numeric(20, 4),
  low_52w             numeric(20, 4),
  pct_from_52w_high   numeric(12, 4),   -- <=0, how far below the high (%)
  pct_from_52w_low    numeric(12, 4),   -- >=0, how far above the low (%)
  gap_pct             numeric(12, 4),   -- (day_open - prev_close) / prev_close * 100
  intraday_vol_pct    numeric(12, 4),   -- (day_high - day_low) / prev_close * 100

  -- Fundamentals (from latest_financials).
  market_cap          numeric(20, 2),   -- Rs. Cr / USD mn
  mcap_rank           integer,          -- 1 = largest within (country); for SEBI cap bands
  pe_ratio            numeric(14, 4),
  roe                 numeric(12, 4),
  roce                numeric(10, 4),
  debt_to_equity      numeric(12, 4),
  dividend_yield      numeric(10, 4),
  free_cash_flow      numeric(20, 2),
  revenue_growth_yoy  numeric(12, 4),
  profit_growth_yoy   numeric(12, 4),

  refreshed_at        timestamptz not null default now()
);

create index if not exists stock_snapshot_country_idx     on public.stock_snapshot (country);
create index if not exists stock_snapshot_sector_idx      on public.stock_snapshot (sector);
create index if not exists stock_snapshot_change_idx       on public.stock_snapshot (change_pct_1d);
create index if not exists stock_snapshot_mcap_idx         on public.stock_snapshot (market_cap desc nulls last);
create index if not exists stock_snapshot_tradeval_idx     on public.stock_snapshot (trade_value desc nulls last);
create index if not exists stock_snapshot_mcap_rank_idx    on public.stock_snapshot (country, mcap_rank);

-- --- 4. Universe membership (Nifty 50/100/500, F&O) -----------------------
-- Static lists, seeded from db/universes/*.json by scripts/seed-universes.mjs.
-- "All" is implicit (every tracked stock) and needs no rows here.
create table if not exists public.universe_members (
  universe   text not null,   -- 'NIFTY_50' | 'NIFTY_100' | 'NIFTY_500' | 'FNO' | 'SP_500' | ...
  country    text not null,   -- 'IN' | 'US'
  symbol     text not null,   -- exchange ticker as listed in the JSON seed
  asset_id   uuid references public.assets (id) on delete cascade,  -- resolved at seed time
  primary key (universe, symbol)
);

create index if not exists universe_members_asset_idx on public.universe_members (asset_id);
create index if not exists universe_members_lookup_idx on public.universe_members (universe, country);

-- --- 5. Saved screens (per user) ------------------------------------------
create table if not exists public.saved_screens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  name        text not null,
  market      text not null default 'IN',      -- 'US' | 'IN'
  universe    text not null default 'ALL',
  filters     jsonb not null default '[]'::jsonb,   -- [{field, op, value}]
  sort        jsonb,                                -- {field, dir}
  columns     jsonb,                                -- optional column layout
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists saved_screens_user_idx on public.saved_screens (user_id, updated_at desc);
