-- Sector Catalyst Thrust: provenance-tracked session_volume on latest_quotes,
-- versioned two-level sector/industry memberships, and persisted 5-minute checkpoint tables.

alter table public.latest_quotes
  add column if not exists session_volume bigint,
  add column if not exists session_volume_date date,
  add column if not exists session_volume_source text,
  add column if not exists session_volume_at timestamptz;

create table if not exists public.sector_group_memberships (
  market text not null check (market in ('IN', 'US')),
  asset_id uuid not null references public.assets(id) on delete cascade,
  taxonomy_version text not null,
  broad_sector text not null,
  industry_group text,
  tags text[] not null default '{}',
  source text not null,
  updated_at timestamptz not null default now(),
  primary key (market, asset_id, taxonomy_version)
);

create index if not exists sector_group_memberships_lookup_idx
  on public.sector_group_memberships (market, taxonomy_version, broad_sector, industry_group);

create table if not exists public.sector_thrust_runs (
  id bigint generated always as identity primary key,
  market text not null check (market in ('IN', 'US')),
  session_date date not null,
  checkpoint_at timestamptz not null,
  mode text not null default 'LIVE' check (mode in ('LIVE', 'EOD', 'REPLAY')),
  rule_version text not null,
  taxonomy_version text not null,
  curve_version text,
  status text not null check (status in ('LIVE', 'EOD', 'UNVERIFIED', 'INCONCLUSIVE')),
  unverified_reason text,
  eligible_universe_count integer not null default 0,
  unclassified_count integer not null default 0,
  scan_duration_ms integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sector_thrust_runs_latest_idx
  on public.sector_thrust_runs (market, mode, session_date desc, checkpoint_at desc);

create table if not exists public.sector_thrust_groups (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.sector_thrust_runs(id) on delete cascade,
  market text not null check (market in ('IN', 'US')),
  session_date date not null,
  group_level text not null check (group_level in ('SECTOR', 'INDUSTRY')),
  group_key text not null,
  group_label text not null,
  parent_sector text,
  status text not null check (status in ('ACTIVE', 'FADED', 'WATCH', 'UNVERIFIED', 'INCONCLUSIVE')),
  unverified_reason text,
  eligible_count integer not null default 0,
  price_fresh_count integer not null default 0,
  volume_fresh_count integer not null default 0,
  qualifying_count integer not null default 0,
  median_return_pct numeric,
  median_rvol numeric,
  volume_confirmation_route text,
  first_triggered_at timestamptz,
  related_news jsonb not null default '[]'::jsonb
);

create index if not exists sector_thrust_groups_run_idx
  on public.sector_thrust_groups (run_id, group_level, status);

create index if not exists sector_thrust_groups_session_idx
  on public.sector_thrust_groups (market, session_date desc, group_level, group_key);

create table if not exists public.sector_thrust_members (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.sector_thrust_groups(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  ticker text not null,
  name text,
  role text not null check (role in ('LEADER', 'CATCH_UP')),
  price numeric not null,
  return_pct numeric not null,
  rvol numeric,
  avg_traded_value_20d numeric,
  atr_pct numeric,
  atr_extension numeric,
  first_seen_at timestamptz not null,
  reason text not null,
  reference_entry numeric,
  invalidation_stop numeric,
  target_zone numeric
);

create index if not exists sector_thrust_members_group_idx
  on public.sector_thrust_members (group_id, role);
