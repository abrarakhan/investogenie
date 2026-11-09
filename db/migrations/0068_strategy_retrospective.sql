create table if not exists public.strategy_retrospective_results (
  market text not null check (market in ('IN','US')),
  engine text not null,
  asset_id uuid not null references public.assets(id) on delete cascade,
  signal_date date not null,
  first_ready_at timestamptz not null,
  entry_date date not null,
  entry_price numeric(20,6) not null,
  horizon_sessions integer not null check (horizon_sessions in (5,10,20)),
  exit_date date not null,
  exit_price numeric(20,6) not null,
  realized_return_pct numeric(14,6) not null,
  max_favorable_pct numeric(14,6) not null,
  max_adverse_pct numeric(14,6) not null,
  methodology_version text not null,
  computed_at timestamptz not null default now(),
  primary key(market,engine,asset_id,signal_date,horizon_sessions)
);

create index if not exists strategy_retrospective_results_lookup_idx
  on public.strategy_retrospective_results(market,horizon_sessions,engine,signal_date desc);

create table if not exists public.strategy_retrospective_scorecards (
  market text not null check (market in ('IN','US')),
  engine text not null,
  horizon_sessions integer not null check (horizon_sessions in (5,10,20)),
  observations integer not null,
  positive_outcomes integer not null,
  win_rate_pct numeric(12,4),
  average_return_pct numeric(14,6),
  median_return_pct numeric(14,6),
  average_max_favorable_pct numeric(14,6),
  average_max_adverse_pct numeric(14,6),
  methodology_version text not null,
  computed_at timestamptz not null default now(),
  primary key(market,engine,horizon_sessions)
);

comment on table public.strategy_retrospective_results is
  'Point-in-time retrospective of recorded production-ready signals. Entry is the next completed session open; never a reconstructed historical signal.';
