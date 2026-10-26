create table if not exists public.candidate_signal_observations (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  market text not null check (market in ('IN', 'US')),
  engine text not null check (engine in ('STRONG_SWING', 'MOMENTUM_IGNITION', 'MOMENTUM_IGNITION_V2')),
  asset_id uuid not null references public.assets(id) on delete cascade,
  status text not null,
  ready boolean not null,
  quote_as_of timestamptz,
  observed_at timestamptz not null default now()
);

create index if not exists candidate_signal_observations_asset_time_idx
  on public.candidate_signal_observations(asset_id, engine, observed_at desc);

create index if not exists candidate_signal_observations_user_time_idx
  on public.candidate_signal_observations(user_id, market, observed_at desc);
