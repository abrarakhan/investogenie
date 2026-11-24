-- Tracks nightly automated ML walk-forward readiness checks and one-time notification state.
create table if not exists public.ml_readiness_checks (
  market            text primary key check (market in ('IN', 'US')),
  verdict           text not null,
  samples           integer not null default 0,
  distinct_dates    integer not null default 0,
  samples_with_news integer not null default 0,
  oos_ml_auc        numeric(8, 4),
  oos_baseline_auc  numeric(8, 4),
  oos_brier         numeric(8, 4),
  report_json       jsonb not null default '{}'::jsonb,
  notified_at       timestamptz,
  checked_at        timestamptz not null default now()
);
