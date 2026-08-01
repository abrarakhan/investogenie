-- Canonical AMFI scheme-option registry and its bridge to portfolio snapshots.
--
-- AMFI publishes one row per plan/option. A single underlying portfolio can
-- therefore have several ISINs (Direct Growth, Regular Growth, IDCW, etc.).
-- fund_schemes remains the portfolio-level entity used by X-Ray snapshots;
-- fund_scheme_identifiers provides the many-to-one identity bridge.

create table if not exists public.amfi_scheme_master (
  amfi_code              text primary key,
  scheme_name            text not null,
  amc                    text,
  scheme_category        text,
  portfolio_key          text not null,
  isin_payout_or_growth  text,
  isin_reinvestment      text,
  plan_type              text not null check (plan_type in ('DIRECT', 'REGULAR', 'OTHER')),
  option_type            text not null check (option_type in ('GROWTH', 'IDCW', 'BONUS', 'OTHER')),
  nav                    numeric(20, 6),
  nav_date               date,
  is_active              boolean not null default true,
  source                 text not null default 'AMFI_NAV',
  source_url             text,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  synced_at              timestamptz not null default now()
);

create index if not exists amfi_scheme_master_amc_idx
  on public.amfi_scheme_master (amc);
create index if not exists amfi_scheme_master_portfolio_idx
  on public.amfi_scheme_master (portfolio_key);
create index if not exists amfi_scheme_master_isin_growth_idx
  on public.amfi_scheme_master (isin_payout_or_growth)
  where isin_payout_or_growth is not null;
create index if not exists amfi_scheme_master_isin_reinvest_idx
  on public.amfi_scheme_master (isin_reinvestment)
  where isin_reinvestment is not null;

create table if not exists public.fund_scheme_identifiers (
  identifier_type   text not null check (identifier_type in ('ISIN', 'AMFI_CODE', 'SEBI_CODE', 'RTA_CODE')),
  identifier_value  text not null,
  scheme_code       text not null references public.fund_schemes (scheme_code) on delete cascade,
  amfi_code         text references public.amfi_scheme_master (amfi_code) on delete set null,
  plan_type         text check (plan_type in ('DIRECT', 'REGULAR', 'OTHER')),
  option_type       text check (option_type in ('GROWTH', 'IDCW', 'BONUS', 'OTHER')),
  source            text not null default 'AMFI_NAV',
  is_active         boolean not null default true,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  primary key (identifier_type, identifier_value)
);

create index if not exists fund_scheme_identifiers_scheme_idx
  on public.fund_scheme_identifiers (scheme_code);
create index if not exists fund_scheme_identifiers_amfi_idx
  on public.fund_scheme_identifiers (amfi_code)
  where amfi_code is not null;

-- Preserve the legacy single ISIN as a bridge identifier. The AMFI sync will
-- enrich each scheme with every plan/option ISIN it can resolve.
insert into public.fund_scheme_identifiers (
  identifier_type, identifier_value, scheme_code, source, is_active
)
select 'ISIN', upper(trim(isin)), scheme_code, 'FUND_SCHEME', true
  from public.fund_schemes
 where isin ~* '^[A-Z]{2}[A-Z0-9]{10}$'
on conflict (identifier_type, identifier_value) do nothing;
