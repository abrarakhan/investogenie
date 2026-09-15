create table if not exists public.live_market_targets (
  asset_id uuid not null references public.assets(id) on delete cascade,
  surface text not null check (surface in ('swing','strong_swing','news_swing','trade_ledger')),
  last_seen_at timestamptz not null default now(),
  primary key (asset_id, surface)
);

create index if not exists live_market_targets_recent_idx
  on public.live_market_targets (last_seen_at desc, asset_id);

