-- Record which benchmark produced each Strong Swing capture.
--
-- The forward audit replays a capture and re-derives its gates. It previously re-selected the
-- benchmark at audit time using a calendar-day freshness rule, while production selects on
-- trading-session freshness — so the checker could replay a capture against a different
-- benchmark than the one that produced it. Worse, the selection was relative to the audit
-- date, so replaying an older capture used whichever benchmark looks best today rather than
-- the one in effect then.
--
-- Storing the identity makes the replay exact. Nullable because captures written before this
-- column exists cannot be back-filled: the audit falls back to a point-in-time selection for
-- those and says so.

alter table public.strong_swing_snapshots
  add column if not exists benchmark_asset_id uuid references public.assets(id),
  add column if not exists benchmark_latest_bar_date date;

comment on column public.strong_swing_snapshots.benchmark_asset_id is
  'Benchmark actually used for this capture, replayed verbatim by the forward audit.';
comment on column public.strong_swing_snapshots.benchmark_latest_bar_date is
  'Latest benchmark bar visible at capture time; bounds the replay window.';
