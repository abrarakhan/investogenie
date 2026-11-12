-- A reconciliation run that fetched the complete order and trade history. Most
-- runs fetch only recent days; the worker repeats a full run when none is recent.
alter table public.breeze_broker_syncs
  add column if not exists full_history boolean not null default false;
