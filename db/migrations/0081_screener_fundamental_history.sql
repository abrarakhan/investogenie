create table if not exists public.screener_fundamental_latest (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  report_date date not null,
  net_profit numeric(20,2),
  revenue_cagr_3y numeric(12,4),
  revenue_cagr_5y numeric(12,4),
  profit_cagr_3y numeric(12,4),
  profit_cagr_5y numeric(12,4),
  positive_profit_years_pct numeric(12,4),
  median_roce_5y numeric(12,4),
  median_cash_conversion_5y numeric(12,4),
  median_fcf_margin_5y numeric(12,4),
  history_years integer not null default 0,
  feature_version text not null,
  refreshed_at timestamptz not null default now()
);

create table if not exists public.asset_shareholding_reports (
  asset_id uuid not null references public.assets(id) on delete cascade,
  period_end_date date not null,
  disclosed_at timestamptz not null,
  promoter_holding_pct numeric(10,4),
  public_holding_pct numeric(10,4),
  source text not null,
  source_url text,
  imported_at timestamptz not null default now(),
  primary key(asset_id, period_end_date)
);

create index if not exists asset_shareholding_reports_disclosed_idx
  on public.asset_shareholding_reports(asset_id, disclosed_at desc);

alter table public.stock_snapshot
  add column if not exists net_profit numeric(20,2),
  add column if not exists revenue_cagr_3y numeric(12,4),
  add column if not exists revenue_cagr_5y numeric(12,4),
  add column if not exists profit_cagr_3y numeric(12,4),
  add column if not exists profit_cagr_5y numeric(12,4),
  add column if not exists positive_profit_years_pct numeric(12,4),
  add column if not exists median_roce_5y numeric(12,4),
  add column if not exists median_cash_conversion_5y numeric(12,4),
  add column if not exists median_fcf_margin_5y numeric(12,4),
  add column if not exists promoter_holding_pct numeric(10,4),
  add column if not exists promoter_holding_change_qoq numeric(10,4);

comment on table public.screener_fundamental_latest is
  'Python-calculated metrics derived from the full stored annual financial-report history.';
comment on table public.asset_shareholding_reports is
  'Point-in-time quarterly ownership filings; disclosed_at controls when a value becomes usable.';
