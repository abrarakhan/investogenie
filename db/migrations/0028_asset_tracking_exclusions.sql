-- Persistent, auditable exclusions for listings that cannot participate in
-- quote/history-backed analysis. Assets are soft-disabled rather than deleted
-- so historical data and the reason for exclusion remain inspectable.

create table if not exists public.asset_tracking_exclusions (
  asset_id       uuid primary key references public.assets (id) on delete cascade,
  reason_code    text not null,
  reason         text not null,
  source         text not null default 'backfill',
  excluded_at    timestamptz not null default now(),
  review_after   timestamptz,
  metadata       jsonb not null default '{}'::jsonb
);

create index if not exists asset_tracking_exclusions_reason_idx
  on public.asset_tracking_exclusions (reason_code, excluded_at desc);
