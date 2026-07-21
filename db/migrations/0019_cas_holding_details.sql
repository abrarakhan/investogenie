-- CAS fund holdings need a durable identity beyond asset ticker. A CAMS/KFintech
-- CAS can contain multiple schemes under one folio and the same ISIN under
-- different folios, so imported positions are keyed by the holding row and
-- retain the statement's ISIN + folio pair for audit and mapping.

create table if not exists public.cas_holding_details (
  holding_id    uuid primary key references public.holdings (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  asset_id      uuid not null references public.assets (id) on delete cascade,
  isin          text,
  folio_number  text,
  holder_name   text,
  cost_value    numeric(18, 4),
  market_value  numeric(18, 4),
  as_of_date    date,
  source_file   text,
  imported_at   timestamptz not null default now(),
  unique (user_id, isin, folio_number)
);

create index if not exists cas_holding_details_user_idx
  on public.cas_holding_details (user_id);

create index if not exists cas_holding_details_isin_idx
  on public.cas_holding_details (isin);

-- The same mutual-fund ISIN can appear in multiple user folios in a CAS. Keep
-- ISIN indexed for lookup/mapping, but do not enforce global uniqueness.
alter table public.mutual_fund_meta
  drop constraint if exists mutual_fund_meta_amfi_code_in_key;

create index if not exists mutual_fund_meta_amfi_code_in_idx
  on public.mutual_fund_meta (amfi_code_in);
