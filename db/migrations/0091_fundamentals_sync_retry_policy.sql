-- Error classification and per-class retry scheduling for fundamentals sync state.
alter table public.fundamentals_sync_state
  add column if not exists error_code text,
  add column if not exists next_retry_at timestamptz,
  add column if not exists failure_count integer not null default 0;

create index if not exists fundamentals_sync_state_retry_idx
  on public.fundamentals_sync_state (country, provider, next_retry_at);
