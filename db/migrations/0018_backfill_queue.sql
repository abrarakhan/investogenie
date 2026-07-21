-- Priority queue for repairing quote-without-history OHLCV coverage gaps.
-- assets.id is uuid in InvestoGenie, so asset_id intentionally differs from
-- the int shape in the product prompt.

create table if not exists public.backfill_queue (
  id           serial primary key,
  asset_id     uuid not null references public.assets (id) on delete cascade,
  symbol       text not null,
  market       text not null check (market in ('IN', 'US')),
  tier         integer not null check (tier between 1 and 6),
  status       text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'failed', 'skipped')),
  attempts     integer not null default 0 check (attempts >= 0),
  last_error   text,
  bars_loaded  integer,
  queued_at    timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz,
  unique (asset_id)
);

create index if not exists backfill_queue_poll_idx
  on public.backfill_queue (status, tier, queued_at);

create index if not exists backfill_queue_tier_status_idx
  on public.backfill_queue (tier, status);

create index if not exists backfill_queue_market_status_idx
  on public.backfill_queue (market, status);
