-- =============================================================================
-- Fund Overlap X-Ray: monthly holdings snapshots.
--
-- The existing mutual_fund_holdings / user_mutual_fund_holdings tables carry a
-- single current weight per (fund, stock) and have no month dimension, so
-- history cannot be kept and "holdings as of <month>" cannot be shown. These
-- tables add that, keyed on ISIN.
--
-- Join rule: ISIN only, never name. Fund factsheets spell the same company a
-- dozen ways ("HDFC Bank Ltd." / "HDFC Bank Limited" / "HDFC BANK"), so name
-- joins silently under-count overlap. Display names live in name_variants.
-- =============================================================================

create table if not exists public.fund_schemes (
  scheme_code     text primary key,               -- provider scheme code
  isin            text,                           -- ISIN of the SCHEME itself
  name            text not null,
  amc             text,
  category        text,                           -- e.g. Equity
  sub_category    text,                           -- e.g. Flexi Cap
  asset_id        uuid references public.assets (id) on delete set null,
  source          text not null default 'MFDATA', -- MFDATA | AMC_DISCLOSURE
  last_synced_at  timestamptz,
  latest_month    date,                           -- newest snapshot held
  created_at      timestamptz not null default now()
);

create index if not exists fund_schemes_name_idx on public.fund_schemes (lower(name));
create index if not exists fund_schemes_amc_idx  on public.fund_schemes (amc);
-- Freshness tracking for the monthly sync / on-demand fetch.
create index if not exists fund_schemes_stale_idx on public.fund_schemes (last_synced_at nulls first);

-- Instrument classification. Cash, TREPS and derivatives have no ISIN, so they
-- get pseudo-instruments: they must appear in allocation but must NEVER count
-- toward stock overlap (two funds both holding 5% cash are not 5% overlapped).
do $$ begin
  create type public.fund_instrument_type as enum
    ('EQUITY','DEBT','CASH_EQUIVALENT','DERIVATIVE','OTHER');
exception when duplicate_object then null; end $$;

create table if not exists public.fund_holdings_snapshot (
  scheme_code      text not null references public.fund_schemes (scheme_code) on delete cascade,
  month            date not null,                 -- first day of the disclosure month
  instrument_isin  text not null,                 -- real ISIN, or CASH:/DERIV: pseudo-key
  instrument_name  text not null,                 -- as printed on this factsheet
  weight_pct       numeric(9, 4) not null,
  sector           text,
  instrument_type  public.fund_instrument_type not null default 'EQUITY',

  -- Debt sleeve, present only when the factsheet discloses them.
  rating           text,
  maturity_date    date,
  coupon_pct       numeric(8, 4),

  source           text not null default 'MFDATA',
  primary key (scheme_code, month, instrument_isin)
);

create index if not exists fund_holdings_month_idx   on public.fund_holdings_snapshot (scheme_code, month desc);
-- Drives the overlap join: find every scheme holding a given ISIN in a month.
create index if not exists fund_holdings_isin_idx    on public.fund_holdings_snapshot (instrument_isin, month);
create index if not exists fund_holdings_equity_idx  on public.fund_holdings_snapshot (scheme_code, month)
  where instrument_type = 'EQUITY';

-- Display names per ISIN, so the UI can show a canonical label while the join
-- stays on ISIN. Populated as variants are encountered across factsheets.
create table if not exists public.instrument_name_variants (
  isin        text not null,
  name        text not null,
  seen_count  integer not null default 1,
  last_seen   timestamptz not null default now(),
  primary key (isin, name)
);

-- Per scheme-month weight audit. Weights should sum to ~100; anything outside
-- +/-2% means a partial or malformed factsheet and must be flagged rather than
-- silently used, because it skews every overlap number computed from it.
create or replace view public.fund_snapshot_health as
  select
    scheme_code,
    month,
    round(sum(weight_pct), 4)                                        as total_weight_pct,
    count(*)                                                         as line_items,
    count(*) filter (where instrument_type = 'EQUITY')               as equity_lines,
    count(*) filter (where instrument_type = 'CASH_EQUIVALENT')      as cash_lines,
    round(sum(weight_pct) filter (where instrument_type = 'EQUITY'), 4) as equity_weight_pct,
    abs(100 - sum(weight_pct)) <= 2                                  as weights_ok
  from public.fund_holdings_snapshot
  group by scheme_code, month;
