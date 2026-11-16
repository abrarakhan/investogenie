-- Historical replay of the Strong Swing engine.
--
-- Forward testing enrols roughly one Strong Swing signal a week, so a thirty-signal
-- sample is months away. The engine is a pure function of completed bars, and
-- daily_ohlcv holds a decade of them, so the same code can be replayed over history
-- to produce that sample now. These tables hold the replay's signals and graded
-- outcomes; nothing here feeds the live screen.

create table if not exists public.strong_swing_replay_runs (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('IN','US')),
  model_version text not null,
  methodology_version text not null,
  -- Which gates the replay could actually evaluate. History has no live broker quote
  -- and, before the results calendar existed, no company-results dates either; a run
  -- that could not evaluate a gate must say so rather than imply it passed.
  results_mode text not null check (results_mode in ('strict','ignored')),
  live_execution_evaluated boolean not null default false,
  benchmark_asset_id uuid references public.assets(id),
  from_date date not null,
  to_date date not null,
  horizon_sessions integer not null check (horizon_sessions > 0),
  assets_scanned integer not null default 0,
  sessions_scanned bigint not null default 0,
  signals integer not null default 0,
  created_at timestamptz not null default now(),
  check (from_date <= to_date)
);

create table if not exists public.strong_swing_replay_signals (
  run_id uuid not null references public.strong_swing_replay_runs(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  ticker text not null,
  signal_date date not null,
  strength_score numeric(6,2),
  plan_entry numeric(20,4),
  plan_stop numeric(20,4),
  plan_target numeric(20,4),
  atr numeric(20,4),
  expected_days integer,
  -- Null when the signal was recorded but never graded: the replay window ended
  -- before a next session existed to enter on.
  entry_date date,
  entry_price numeric(20,4),
  exit_date date,
  exit_price numeric(20,4),
  exit_reason text check (exit_reason in ('TARGET','STOP','HORIZON','OPEN')),
  return_pct numeric(12,4),
  max_favorable_pct numeric(12,4),
  max_adverse_pct numeric(12,4),
  sessions_held integer,
  primary key (run_id, asset_id, signal_date)
);

create index if not exists strong_swing_replay_signals_run_idx
  on public.strong_swing_replay_signals(run_id, signal_date);

comment on table public.strong_swing_replay_runs is
  'One historical replay of the Strong Swing engine; results_mode and live_execution_evaluated record which gates the run could judge.';
comment on table public.strong_swing_replay_signals is
  'Every EXECUTION_READY signal a replay produced, graded by entering at the next session open.';
