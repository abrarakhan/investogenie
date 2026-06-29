-- Provider attempt state keeps bounded recurring fundamentals jobs moving
-- through the universe even when individual symbols are unsupported.
create table if not exists public.fundamentals_sync_state (
  country         text not null,
  ticker          text not null,
  provider        text not null,
  last_attempt_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error      text,
  primary key (country, ticker, provider)
);

create index if not exists fundamentals_sync_state_attempt_idx
  on public.fundamentals_sync_state (country, provider, last_attempt_at);

create table if not exists public.quote_sync_state (
  asset_id        uuid not null references public.assets (id) on delete cascade,
  provider        text not null,
  last_attempt_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error      text,
  primary key (asset_id, provider)
);

create index if not exists quote_sync_state_attempt_idx
  on public.quote_sync_state (provider, last_attempt_at);
