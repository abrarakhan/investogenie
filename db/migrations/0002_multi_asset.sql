-- InvestoGenie multi-asset market-data layer
-- Reference + time-series market data spanning US and Indian markets across
-- Stocks, Bonds, Mutual Funds, Currencies, and Derivatives.
--
-- These tables are public reference/market data. The Next.js app and ingestion
-- jobs access them through direct Postgres connections.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------------
do $$ begin
  create type asset_class as enum ('STOCK', 'BOND', 'MUTUAL_FUND', 'CURRENCY', 'DERIVATIVE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type plan_type as enum ('DIRECT', 'REGULAR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type derivative_instrument as enum ('FUTURE', 'OPTION');
exception when duplicate_object then null; end $$;

do $$ begin
  create type option_right as enum ('CE', 'PE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type settlement_kind as enum ('CASH', 'PHYSICAL');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- assets: the master security catalog (one row per tradable instrument)
-- ---------------------------------------------------------------------------
create table if not exists public.assets (
  id           uuid primary key default gen_random_uuid(),
  ticker       text not null,
  name         text,
  asset_class  asset_class not null,
  exchange     text,                       -- e.g. NASDAQ, NSE, BSE, AMFI
  country      text not null,              -- ISO-3166 alpha-2: 'US', 'IN'
  currency     text not null default 'USD',-- pricing currency: 'USD', 'INR'
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  -- A ticker is unique within an exchange (AAPL@NASDAQ vs RELIANCE@NSE).
  unique (exchange, ticker)
);
create index if not exists assets_asset_class_idx on public.assets (asset_class);
create index if not exists assets_country_idx     on public.assets (country);
create index if not exists assets_ticker_idx       on public.assets (ticker);

-- ---------------------------------------------------------------------------
-- daily_ohlcv: end-of-day price/volume series. open_interest is populated
-- for derivatives and left null for cash instruments.
-- ---------------------------------------------------------------------------
create table if not exists public.daily_ohlcv (
  asset_id       uuid not null references public.assets (id) on delete cascade,
  date           date not null,
  open           numeric(20, 6),
  high           numeric(20, 6),
  low            numeric(20, 6),
  close          numeric(20, 6),
  volume         bigint,
  open_interest  bigint,
  primary key (asset_id, date)
);
-- Reverse-chronological scans per asset are the hot path for analytics.
create index if not exists daily_ohlcv_asset_date_idx
  on public.daily_ohlcv (asset_id, date desc);

-- ---------------------------------------------------------------------------
-- macro_indicators: single-value daily macro/benchmark series keyed by a
-- free-form indicator code (US_10Y_YIELD, USD_INR, BRENT_CRUDE, NIFTY_PE, ...)
-- ---------------------------------------------------------------------------
create table if not exists public.macro_indicators (
  indicator_type  text not null,
  date            date not null,
  value           numeric(20, 6) not null,
  unit            text,                -- 'percent', 'index', 'usd_per_bbl', ...
  primary key (indicator_type, date)
);
create index if not exists macro_indicators_date_idx on public.macro_indicators (date desc);

-- ---------------------------------------------------------------------------
-- mutual_fund_meta: 1:1 extension of an asset of class MUTUAL_FUND
-- ---------------------------------------------------------------------------
create table if not exists public.mutual_fund_meta (
  asset_id       uuid primary key references public.assets (id) on delete cascade,
  amfi_code_in   text unique,           -- AMFI scheme code (Indian funds)
  expense_ratio  numeric(6, 4),         -- e.g. 0.0125 = 1.25%
  category       text,                  -- 'Large Cap', 'Flexi Cap', 'Debt - Gilt'
  exit_load      numeric(6, 4),         -- fractional, e.g. 0.0100 = 1%
  plan_type      plan_type not null default 'DIRECT'
);
create index if not exists mutual_fund_meta_category_idx on public.mutual_fund_meta (category);

-- ---------------------------------------------------------------------------
-- mutual_fund_holdings: fund -> underlying stock weights (look-through)
-- ---------------------------------------------------------------------------
create table if not exists public.mutual_fund_holdings (
  fund_asset_id      uuid not null references public.assets (id) on delete cascade,
  stock_asset_id     uuid not null references public.assets (id) on delete cascade,
  weight_percentage  numeric(7, 4) not null check (weight_percentage >= 0 and weight_percentage <= 100),
  as_of_date         date,
  primary key (fund_asset_id, stock_asset_id)
);
create index if not exists mf_holdings_stock_idx on public.mutual_fund_holdings (stock_asset_id);

-- ---------------------------------------------------------------------------
-- derivative_meta: settlement/expiry detail for DERIVATIVE assets.
-- Captures the settlement-date variation called out in the spec (weekly vs
-- monthly expiries, cash vs physical settlement, option strike/right).
-- ---------------------------------------------------------------------------
create table if not exists public.derivative_meta (
  asset_id             uuid primary key references public.assets (id) on delete cascade,
  underlying_asset_id  uuid references public.assets (id) on delete set null,
  instrument           derivative_instrument not null,
  expiry_date          date not null,
  last_trading_date    date,                 -- may differ from expiry/settlement
  settlement_date      date,                 -- T+1/T+2 etc., varies by segment
  settlement           settlement_kind not null default 'CASH',
  strike               numeric(20, 6),       -- options only
  option_right         option_right,         -- options only (CE/PE)
  lot_size             integer,
  check (
    (instrument = 'OPTION' and strike is not null and option_right is not null)
    or (instrument = 'FUTURE')
  )
);
create index if not exists derivative_meta_underlying_idx on public.derivative_meta (underlying_asset_id);
create index if not exists derivative_meta_expiry_idx     on public.derivative_meta (expiry_date);

-- ---------------------------------------------------------------------------
-- Seed: representative US + India instruments and macro points so the landing
-- page ticker feeds and engines have live data to render immediately.
-- ---------------------------------------------------------------------------
insert into public.assets (ticker, name, asset_class, exchange, country, currency) values
  ('AAPL',     'Apple Inc.',                 'STOCK',    'NASDAQ', 'US', 'USD'),
  ('MSFT',     'Microsoft Corporation',      'STOCK',    'NASDAQ', 'US', 'USD'),
  ('NVDA',     'NVIDIA Corporation',         'STOCK',    'NASDAQ', 'US', 'USD'),
  ('SPY',      'SPDR S&P 500 ETF Trust',     'STOCK',    'NYSE',   'US', 'USD'),
  ('RELIANCE', 'Reliance Industries Ltd',    'STOCK',    'NSE',    'IN', 'INR'),
  ('TCS',      'Tata Consultancy Services',  'STOCK',    'NSE',    'IN', 'INR'),
  ('INFY',     'Infosys Ltd',                'STOCK',    'NSE',    'IN', 'INR'),
  ('US10Y',    'US 10-Year Treasury Note',   'BOND',     'NYSE',   'US', 'USD'),
  ('NIFTY',    'Nifty 50 Index',             'DERIVATIVE','NSE',   'IN', 'INR'),
  ('SENSEX',   'BSE Sensex Index',           'DERIVATIVE','BSE',   'IN', 'INR'),
  ('USDINR',   'US Dollar / Indian Rupee',   'CURRENCY', 'FX',     'IN', 'INR'),
  ('NIFTYFUT', 'Nifty 50 Front-Month Future','DERIVATIVE','NSE',   'IN', 'INR')
on conflict (exchange, ticker) do nothing;

insert into public.macro_indicators (indicator_type, date, value, unit) values
  ('US_10Y_YIELD', current_date, 4.32, 'percent'),
  ('USD_INR',      current_date, 83.45, 'inr_per_usd'),
  ('BRENT_CRUDE',  current_date, 79.10, 'usd_per_bbl')
on conflict (indicator_type, date) do nothing;
