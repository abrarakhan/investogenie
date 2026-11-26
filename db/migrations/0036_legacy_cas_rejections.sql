-- Bootstrap the legacy table before 0037 adds resolution tracking.
create table if not exists public.cas_import_rejected_holdings (
  rejected_at timestamptz not null default now(),
  reason text not null,
  user_id uuid not null,
  portfolio_id uuid not null,
  asset_id uuid,
  ticker text not null,
  name text,
  quantity numeric,
  avg_cost numeric,
  value numeric
);

-- An unmatched CAS holding is recorded before an asset can be identified.
alter table public.cas_import_rejected_holdings alter column asset_id drop not null;
