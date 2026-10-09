alter table public.strong_swing_snapshots
  add column if not exists snapshot_id uuid default gen_random_uuid(),
  add column if not exists source text not null default 'interactive',
  add column if not exists decision_time time,
  add column if not exists feature_version text,
  add column if not exists scheduler_run_id uuid,
  add column if not exists market_date date,
  add column if not exists data_cutoff timestamptz,
  add column if not exists calendar_version text;

update public.strong_swing_snapshots
   set snapshot_id = coalesce(snapshot_id, gen_random_uuid()),
       market_date = coalesce(market_date, latest_bar_date),
       data_cutoff = coalesce(data_cutoff, captured_at),
       feature_version = coalesce(feature_version, 'legacy-interactive-v0'),
       calendar_version = coalesce(calendar_version, 'legacy-calendar-v0')
 where snapshot_id is null
    or market_date is null
    or data_cutoff is null
    or feature_version is null
    or calendar_version is null;

alter table public.strong_swing_snapshots
  alter column snapshot_id set not null,
  add constraint strong_swing_snapshots_snapshot_id_key unique (snapshot_id),
  add constraint strong_swing_snapshots_source_check check (source in ('scheduled', 'interactive')),
  add constraint strong_swing_snapshots_scheduled_provenance_check check (
    source <> 'scheduled' or (
      decision_time is not null and feature_version is not null and scheduler_run_id is not null
      and market_date is not null and data_cutoff is not null and calendar_version is not null
    )
  );

create unique index if not exists strong_swing_snapshots_canonical_idx
  on public.strong_swing_snapshots(market, market_date, decision_time, asset_id, source, feature_version)
  where source = 'scheduled';

create table if not exists public.ml_decision_calendar (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('IN', 'US')),
  calendar_version text not null,
  decision_time time not null,
  timezone text not null,
  grace_minutes integer not null check (grace_minutes between 0 and 240),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (market, calendar_version, decision_time),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.ml_universe_snapshots (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('IN', 'US')),
  market_date date not null,
  universe_version text not null,
  asset_id uuid not null references public.assets(id),
  eligible boolean not null,
  liquidity_bucket text,
  market_cap_bucket text,
  eligibility_reason jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  unique (market, market_date, universe_version, asset_id)
);

create table if not exists public.ml_feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  candidate_snapshot_id uuid not null references public.strong_swing_snapshots(snapshot_id),
  universe_snapshot_id uuid references public.ml_universe_snapshots(id),
  market text not null check (market in ('IN', 'US')),
  asset_id uuid not null references public.assets(id),
  asof_market_date date not null,
  snapshot_source text not null check (snapshot_source in ('scheduled', 'interactive')),
  candidate_status text not null,
  feature_version text not null,
  inclusion_policy_version text not null,
  calendar_version text not null,
  data_timestamp timestamptz not null,
  feature_values jsonb not null,
  eligible_for_training boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (candidate_snapshot_id, feature_version)
);

create table if not exists public.ml_labels (
  id uuid primary key default gen_random_uuid(),
  feature_snapshot_id uuid not null references public.ml_feature_snapshots(id),
  market text not null check (market in ('IN', 'US')),
  asset_id uuid not null references public.assets(id),
  asof_market_date date not null,
  outcome text not null check (outcome in ('TARGET_FIRST','STOP_FIRST','SAME_BAR_AMBIGUOUS','WINDOW_EXPIRED','NOT_ENTERED','INVALID_DATA')),
  binary_target smallint check (binary_target in (0, 1)),
  realized_return numeric(20, 10),
  max_favorable_excursion numeric(20, 10),
  max_adverse_excursion numeric(20, 10),
  sessions_to_outcome integer,
  entry_session date,
  entry_price numeric(20, 6),
  exit_session date,
  exit_price numeric(20, 6),
  entry_used numeric(20, 6) not null,
  initial_stop_used numeric(20, 6) not null,
  target_used numeric(20, 6) not null,
  trailing_distance_used numeric(20, 6) not null,
  charges_bps numeric(10, 4) not null,
  slippage_bps_per_side numeric(10, 4) not null,
  entry_fill_policy_version text not null,
  trailing_policy_version text not null,
  label_version text not null,
  calendar_version text not null,
  invalid_reason text,
  path_json jsonb not null default '{}'::jsonb,
  labeled_at timestamptz not null default now(),
  unique (feature_snapshot_id, label_version, trailing_policy_version, entry_fill_policy_version, calendar_version)
);

create table if not exists public.ml_models (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('IN', 'US')),
  model_version text not null unique,
  lifecycle_state text not null check (lifecycle_state in ('CANDIDATE','SHADOW','VALIDATED','SUSPENDED','RETIRED')),
  artifact_uri text not null,
  artifact_checksum_sha256 text not null check (artifact_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  calibrator_checksum_sha256 text check (calibrator_checksum_sha256 is null or calibrator_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  training_code_git_commit text not null,
  training_start_date date not null,
  training_cutoff date not null,
  universe_version text not null,
  feature_version text not null,
  label_version text not null,
  trailing_policy_version text not null,
  entry_fill_policy_version text not null,
  inclusion_policy_version text not null,
  calendar_version text not null,
  hyperparameters jsonb not null,
  dependency_versions jsonb not null,
  calibration_method text not null check (calibration_method in ('SIGMOID','ISOTONIC')),
  created_at timestamptz not null default now(),
  check (training_cutoff >= training_start_date)
);

create table if not exists public.ml_walk_forward_runs (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.ml_models(id),
  fold_number integer not null check (fold_number > 0),
  training_start date not null,
  training_end date not null,
  calibration_start date not null,
  calibration_end date not null,
  test_start date not null,
  test_end date not null,
  purge_sessions integer not null check (purge_sessions > 0),
  embargo_sessions integer not null check (embargo_sessions > 0),
  independent_test_clusters integer not null default 0,
  independent_positive_clusters integer not null default 0,
  accepted boolean not null,
  rejection_reason text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (model_id, fold_number)
);

create table if not exists public.ml_promotion_decisions (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.ml_models(id),
  decision text not null check (decision in ('REGISTER_GATES','PROMOTE_SHADOW','VALIDATE','SERVE','SUSPEND','RETIRE','ROLLBACK')),
  evaluation_run_ids uuid[] not null default '{}',
  frozen_thresholds jsonb not null,
  observed_metrics jsonb,
  reason text not null,
  decided_by text not null,
  decided_at timestamptz not null default now()
);

alter table public.ml_models
  add column if not exists promotion_decision_id uuid references public.ml_promotion_decisions(id);

create table if not exists public.swing_predictions (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.ml_models(id),
  candidate_snapshot_id uuid not null references public.strong_swing_snapshots(snapshot_id),
  feature_snapshot_id uuid not null references public.ml_feature_snapshots(id),
  model_version text not null,
  feature_version text not null,
  label_version text not null,
  training_cutoff date not null,
  raw_score numeric(12, 10) not null check (raw_score between 0 and 1),
  calibrated_probability numeric(12, 10) not null check (calibrated_probability between 0 and 1),
  calibration_method text not null,
  candidate_status text not null,
  prediction_timestamp timestamptz not null default now(),
  data_timestamp timestamptz not null,
  top_features jsonb not null default '[]'::jsonb,
  served_state text not null check (served_state in ('SHADOW','SERVED')),
  supersedes_prediction_id uuid references public.swing_predictions(id),
  unique (model_id, candidate_snapshot_id, prediction_timestamp)
);

create index if not exists swing_predictions_candidate_idx
  on public.swing_predictions(candidate_snapshot_id, prediction_timestamp desc);

create table if not exists public.ml_serving_assignments (
  market text primary key check (market in ('IN', 'US')),
  model_id uuid not null unique references public.ml_models(id),
  promotion_decision_id uuid not null references public.ml_promotion_decisions(id),
  assigned_at timestamptz not null default now()
);

create table if not exists public.ml_serving_assignment_history (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('IN', 'US')),
  model_id uuid references public.ml_models(id),
  promotion_decision_id uuid not null references public.ml_promotion_decisions(id),
  action text not null check (action in ('ASSIGN','REMOVE','ROLLBACK')),
  reason text not null,
  recorded_at timestamptz not null default now()
);

create table if not exists public.ml_monitor_observations (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.ml_models(id),
  market text not null check (market in ('IN', 'US')),
  monitor_type text not null,
  status text not null check (status in ('HEALTHY','WARNING','DRIFT','PIPELINE_FAILURE')),
  observed_value jsonb not null,
  threshold jsonb,
  observed_at timestamptz not null default now()
);

create or replace function public.prevent_ml_record_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable; write a versioned replacement instead', tg_table_name;
end;
$$;

create trigger ml_feature_snapshots_immutable
  before update or delete on public.ml_feature_snapshots
  for each row execute function public.prevent_ml_record_mutation();

create trigger ml_labels_immutable
  before update or delete on public.ml_labels
  for each row execute function public.prevent_ml_record_mutation();

create trigger ml_promotion_decisions_immutable
  before update or delete on public.ml_promotion_decisions
  for each row execute function public.prevent_ml_record_mutation();

create trigger swing_predictions_immutable
  before update or delete on public.swing_predictions
  for each row execute function public.prevent_ml_record_mutation();

create or replace function public.guard_ml_model_contract()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['lifecycle_state', 'promotion_decision_id'])
     <> (to_jsonb(old) - array['lifecycle_state', 'promotion_decision_id']) then
    raise exception 'ml_models artifacts and data contracts are immutable';
  end if;
  return new;
end;
$$;

create trigger ml_models_contract_immutable
  before update on public.ml_models
  for each row execute function public.guard_ml_model_contract();

insert into public.ml_decision_calendar
  (market, calendar_version, decision_time, timezone, grace_minutes, effective_from)
values ('IN', 'NSE-calendar-v1', time '18:45', 'Asia/Kolkata', 30, date '2026-10-09')
on conflict (market, calendar_version, decision_time) do nothing;

comment on table public.swing_predictions is
  'Immutable advisory predictions. They never authorize or place broker orders.';
