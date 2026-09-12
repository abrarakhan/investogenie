-- Preserve rejected CAS rows for audit while hiding errors superseded by a
-- later successful statement import.
alter table if exists public.cas_import_rejected_holdings
  add column if not exists resolved_at timestamptz;

create index if not exists cas_import_rejected_holdings_active_idx
  on public.cas_import_rejected_holdings (user_id, rejected_at desc)
  where resolved_at is null;
