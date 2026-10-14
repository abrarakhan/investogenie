-- Authoritative negative coverage from complete exchange calendar snapshots.
alter table public.corporate_event_sync_state
  add column if not exists authoritative_source text,
  add column if not exists authoritative_as_of date,
  add column if not exists authoritative_coverage_from date,
  add column if not exists authoritative_coverage_through date,
  add column if not exists authoritative_imported_at timestamptz;

alter table public.corporate_event_sync_state
  drop constraint if exists corporate_event_authoritative_window_check;

alter table public.corporate_event_sync_state
  add constraint corporate_event_authoritative_window_check check (
    authoritative_coverage_from is null
    or authoritative_coverage_through is null
    or authoritative_coverage_from <= authoritative_coverage_through
  );
