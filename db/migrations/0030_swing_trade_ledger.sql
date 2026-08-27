-- Real swing trades, kept separate from paper forward tests. Projection fields
-- are frozen at entry so later scans cannot rewrite the plan the user bought.
create table if not exists public.swing_trade_ledger (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.users (id) on delete cascade,
  asset_id                 uuid not null references public.assets (id) on delete restrict,
  market                   text not null check (market in ('IN', 'US')),
  status                   text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  bought_on                date not null,
  buy_price                numeric(20, 6) not null check (buy_price > 0),
  quantity                 numeric(20, 6) not null check (quantity > 0),
  currency                 text not null,
  strategy_key             text not null default 'DEFAULT_SWING',
  strategy_label           text not null default 'Default Swing',
  signal_verdict           text,
  signal_as_of             date,
  signal_score             numeric(8, 6),
  projection_entry         numeric(20, 6),
  projected_target         numeric(20, 6) not null check (projected_target > 0),
  projected_stop           numeric(20, 6) not null check (projected_stop >= 0),
  projected_trailing_stop  numeric(20, 6),
  projected_atr            numeric(20, 6),
  trailing_distance        numeric(20, 6),
  expected_holding_days    integer not null check (expected_holding_days between 1 and 365),
  projection_snapshot      jsonb not null default '{}'::jsonb,
  notes                    text,
  closed_on                date,
  exit_price               numeric(20, 6),
  close_reason             text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (projected_target > projected_stop),
  check (
    (status = 'OPEN' and closed_on is null and exit_price is null)
    or
    (status = 'CLOSED' and closed_on is not null and exit_price > 0)
  )
);

create index if not exists swing_trade_ledger_user_status_idx
  on public.swing_trade_ledger (user_id, status, bought_on desc);
create index if not exists swing_trade_ledger_asset_idx
  on public.swing_trade_ledger (asset_id, bought_on desc);

comment on table public.swing_trade_ledger is
  'User-recorded real swing trades with immutable entry-time strategy projections.';
