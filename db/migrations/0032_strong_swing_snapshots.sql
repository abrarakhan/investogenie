create table if not exists public.strong_swing_snapshots (
  captured_at       timestamptz not null,
  market            text not null check (market in ('IN', 'US')),
  asset_id          uuid not null references public.assets(id) on delete cascade,
  ticker            text not null,
  rank               integer not null,
  status             text not null,
  strength_score     numeric(6, 2) not null,
  base_score         numeric(8, 4) not null,
  current_price      numeric(20, 6),
  confirmation_entry numeric(20, 6) not null,
  projected_target  numeric(20, 6) not null,
  projected_stop    numeric(20, 6) not null,
  projected_trail   numeric(20, 6) not null,
  expected_days      integer not null,
  latest_bar_date    date not null,
  gates              jsonb not null default '[]'::jsonb,
  metrics            jsonb not null default '{}'::jsonb,
  primary key (captured_at, market, asset_id)
);

create index if not exists strong_swing_snapshots_asset_time_idx
  on public.strong_swing_snapshots(asset_id, captured_at desc);

create index if not exists strong_swing_snapshots_market_time_idx
  on public.strong_swing_snapshots(market, captured_at desc, rank);
