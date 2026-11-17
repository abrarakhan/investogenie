-- Complete the migration 0084 screener contract without rewriting a migration that
-- may already have been applied to a developer database.
alter table public.screener_technical_daily
  add column if not exists tod_rvol numeric(8,2);

comment on column public.screener_technical_daily.tod_rvol is
  'Live cumulative volume divided by the active session curve expectation; null outside a measured live session.';
