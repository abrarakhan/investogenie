create table if not exists public.market_volume_curves (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('IN','US')),
  version text not null unique,
  sample_from date not null,
  sample_through date not null,
  sample_sessions integer not null check (sample_sessions >= 40),
  points jsonb not null,
  active boolean not null default false,
  generated_at timestamptz not null default now(),
  check (sample_from <= sample_through),
  check (jsonb_typeof(points) = 'array')
);

create unique index if not exists market_volume_curves_one_active_idx
  on public.market_volume_curves(market) where active;

comment on table public.market_volume_curves is
  'Versioned market-specific median cumulative intraday-volume curves; Armed Swing requires at least 40 completed sessions.';
