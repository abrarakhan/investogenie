-- Corporate results calendar for entry blackouts.
--
-- A results release can gap price through any technical stop, so new entries are blocked
-- close to one. Coverage is not assumed: corporate_event_sync_state records when each asset
-- was last checked, and an asset without a recent successful check is treated as unverified
-- (no entry) rather than as having no upcoming results.
create table if not exists public.corporate_events (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.assets(id) on delete cascade,
  event_type  text not null check (event_type in ('RESULTS')),
  event_date  date not null,
  source      text not null,
  fetched_at  timestamptz not null default now(),
  unique (asset_id, event_type, event_date)
);

create index if not exists corporate_events_asset_date_idx
  on public.corporate_events(asset_id, event_type, event_date);

create table if not exists public.corporate_event_sync_state (
  asset_id         uuid primary key references public.assets(id) on delete cascade,
  last_attempt_at  timestamptz,
  last_success_at  timestamptz,
  error            text
);

comment on table public.corporate_events is
  'Past and scheduled results dates. Drives the Armed Swing results blackout.';
