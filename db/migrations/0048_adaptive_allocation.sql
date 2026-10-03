create table if not exists public.adaptive_allocation_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  market text not null check (market in ('IN', 'US')),
  name text not null,
  asset_a_id uuid not null references public.assets(id),
  asset_b_id uuid not null references public.assets(id),
  initial_capital numeric(20, 2) not null check (initial_capital > 0),
  fee_bps numeric(10, 4) not null default 15 check (fee_bps >= 0),
  no_trade_band_pct numeric(10, 4) not null default 1 check (no_trade_band_pct >= 0),
  lookback_years integer not null default 5 check (lookback_years between 1 and 20),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (asset_a_id <> asset_b_id)
);

create index if not exists adaptive_allocation_strategies_user_idx
  on public.adaptive_allocation_strategies(user_id, market, status);

create table if not exists public.adaptive_allocation_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.adaptive_allocation_strategies(id) on delete cascade,
  as_of date not null,
  target_weight_a numeric(10, 8) not null,
  target_weight_b numeric(10, 8) not null,
  verdict text not null check (verdict in ('SUCCESS', 'MIXED', 'FAILURE')),
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  unique(strategy_id, as_of)
);

create index if not exists adaptive_allocation_runs_strategy_idx
  on public.adaptive_allocation_runs(strategy_id, as_of desc);

comment on table public.adaptive_allocation_strategies is
  'Research and paper-tracking configurations only. These records never place broker orders.';
