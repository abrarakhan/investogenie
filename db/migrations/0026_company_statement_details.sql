-- Long-Term research statement detail. The existing asset_financial_reports
-- table remains the income/market-metric source used elsewhere; these additions
-- preserve the balance-sheet and cash-flow lines that the provider already
-- returns instead of discarding them after ROCE calculation.

alter table public.asset_financial_reports
  add column if not exists gross_profit numeric(20, 2),
  add column if not exists ebitda numeric(20, 2),
  add column if not exists interest_expense numeric(20, 2),
  add column if not exists income_tax_expense numeric(20, 2),
  add column if not exists diluted_average_shares numeric(24, 4);

create table if not exists public.asset_balance_sheets (
  asset_id             uuid not null references public.assets(id) on delete cascade,
  period_end_date      date not null,
  report_type          text not null check (report_type in ('QUARTERLY', 'ANNUAL')),
  currency             text not null,
  total_assets         numeric(20, 2),
  current_assets       numeric(20, 2),
  cash_and_equivalents numeric(20, 2),
  inventory            numeric(20, 2),
  receivables          numeric(20, 2),
  total_liabilities    numeric(20, 2),
  current_liabilities  numeric(20, 2),
  accounts_payable     numeric(20, 2),
  total_debt           numeric(20, 2),
  short_term_debt      numeric(20, 2),
  long_term_debt       numeric(20, 2),
  shareholders_equity  numeric(20, 2),
  retained_earnings    numeric(20, 2),
  goodwill             numeric(20, 2),
  intangible_assets    numeric(20, 2),
  net_tangible_assets  numeric(20, 2),
  source               text,
  updated_at           timestamptz not null default now(),
  primary key (asset_id, period_end_date, report_type)
);

create index if not exists asset_balance_sheets_asset_period_idx
  on public.asset_balance_sheets (asset_id, report_type, period_end_date desc);

create table if not exists public.asset_cash_flow_statements (
  asset_id              uuid not null references public.assets(id) on delete cascade,
  period_end_date       date not null,
  report_type           text not null check (report_type in ('QUARTERLY', 'ANNUAL')),
  currency              text not null,
  operating_cash_flow   numeric(20, 2),
  capital_expenditure   numeric(20, 2),
  free_cash_flow        numeric(20, 2),
  dividends_paid        numeric(20, 2),
  share_repurchase      numeric(20, 2),
  share_issuance        numeric(20, 2),
  debt_issuance         numeric(20, 2),
  debt_repayment        numeric(20, 2),
  investing_cash_flow   numeric(20, 2),
  financing_cash_flow   numeric(20, 2),
  source                text,
  updated_at            timestamptz not null default now(),
  primary key (asset_id, period_end_date, report_type)
);

create index if not exists asset_cash_flow_asset_period_idx
  on public.asset_cash_flow_statements (asset_id, report_type, period_end_date desc);

-- A compact audit view for data-health checks and manual SQL inspection. Ratios
-- are calculated from matching annual periods only, avoiding mixed-period math.
create or replace view public.latest_company_financial_health as
with latest_annual as (
  select distinct on (f.asset_id)
         f.asset_id, f.period_end_date, f.currency, f.revenue, f.net_profit,
         f.ebit, f.ebitda, f.interest_expense,
         b.total_assets, b.current_assets, b.cash_and_equivalents,
         b.inventory, b.receivables, b.current_liabilities, b.total_debt,
         b.shareholders_equity,
         c.operating_cash_flow, c.capital_expenditure, c.free_cash_flow
    from public.asset_financial_reports f
    left join public.asset_balance_sheets b
      on b.asset_id=f.asset_id and b.period_end_date=f.period_end_date
     and b.report_type=f.report_type
    left join public.asset_cash_flow_statements c
      on c.asset_id=f.asset_id and c.period_end_date=f.period_end_date
     and c.report_type=f.report_type
   where f.report_type='ANNUAL'
   order by f.asset_id, f.period_end_date desc
)
select *,
       current_assets / nullif(current_liabilities, 0) current_ratio,
       (coalesce(cash_and_equivalents, 0) + coalesce(receivables, 0))
         / nullif(current_liabilities, 0) quick_ratio,
       (coalesce(total_debt, 0) - coalesce(cash_and_equivalents, 0))
         / nullif(ebitda, 0) net_debt_to_ebitda,
       ebit / nullif(abs(interest_expense), 0) interest_coverage,
       operating_cash_flow / nullif(net_profit, 0) cash_conversion,
       free_cash_flow / nullif(revenue, 0) * 100 fcf_margin_pct,
       (net_profit - operating_cash_flow) / nullif(total_assets, 0) * 100 accrual_ratio_pct
  from latest_annual;
