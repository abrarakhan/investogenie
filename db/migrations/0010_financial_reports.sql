-- =============================================================================
-- 15-year corporate fundamentals: quarterly/annual financial reports per asset.
-- Stores the reported building blocks (sales, profit, capital employed) plus the
-- point-in-time derived ratios (P/E, market cap, ROCE) and the YoY variances the
-- screener filters on. Monetary columns are normalised to Rs. Crore.
-- =============================================================================

create table if not exists public.asset_financial_reports (
  asset_id            uuid    not null references public.assets (id) on delete cascade,
  period_end_date     date    not null,
  report_type         text    not null,           -- 'QUARTERLY' | 'ANNUAL' | 'TTM'
  fiscal_period       text,                        -- e.g. 'Q1 FY24'
  currency            text    not null default 'INR',

  -- Reported figures (Rs. Cr).
  revenue             numeric(20, 2),              -- net sales / total income
  net_profit          numeric(20, 2),              -- PAT
  operating_profit    numeric(20, 2),
  ebit                numeric(20, 2),
  capital_employed    numeric(20, 2),

  -- Per-share + point-in-time market metrics.
  eps                 numeric(20, 4),
  cmp                 numeric(20, 4),              -- price used for the P/E at report time
  pe_ratio            numeric(14, 4),
  market_cap          numeric(20, 2),              -- Rs. Cr

  -- Profitability + growth (percent).
  roce                numeric(10, 4),              -- %
  profit_variance_yoy numeric(12, 4),             -- % vs same period prior year
  sales_variance_yoy  numeric(12, 4),             -- % vs same period prior year

  source              text,
  updated_at          timestamptz not null default now(),

  -- Composite key: one row per (instrument, period, report grain). A revision of
  -- the same quarter overwrites in place; historic quarters stay pristine.
  primary key (asset_id, period_end_date, report_type)
);

-- Strict composite index for time-series retrieval bounded by (asset, period).
create index if not exists asset_financial_reports_asset_period_idx
  on public.asset_financial_reports (asset_id, period_end_date desc);

-- Latest snapshot per asset (most recent quarterly grain) for the screener join.
create or replace view public.latest_financials
  as
  select distinct on (asset_id)
    asset_id, period_end_date, report_type, fiscal_period, currency,
    revenue, net_profit, eps, cmp, pe_ratio, market_cap, roce,
    profit_variance_yoy, sales_variance_yoy
  from public.asset_financial_reports
  where report_type = 'QUARTERLY'
  order by asset_id, period_end_date desc;
