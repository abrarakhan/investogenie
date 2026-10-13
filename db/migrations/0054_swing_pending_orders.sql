-- Unfilled buy-stop orders, kept apart from swing_trade_ledger.
--
-- An Armed Swing buy-stop has not bought anything until the trigger trades. A pending order is
-- created only from a server-held ARMED plan (armed_swing_plans) and copies its levels. Each
-- confirmed fill inside [trigger, limit] creates one purchased ledger trade and is recorded in
-- swing_pending_order_fills; the order stays PENDING until the filled quantity reaches the
-- ordered quantity, so a partial fill never hides the unfilled remainder.
create table if not exists public.swing_pending_orders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  asset_id              uuid not null references public.assets(id) on delete restrict,
  market                text not null check (market in ('IN', 'US')),
  plan_id               uuid not null references public.armed_swing_plans(id) on delete restrict,
  strategy_key          text not null,
  strategy_label        text not null,
  order_type            text not null default 'BUY_STOP_LIMIT' check (order_type = 'BUY_STOP_LIMIT'),
  status                text not null default 'PENDING' check (status in ('PENDING', 'FILLED', 'CANCELLED')),
  quantity              numeric(20, 6) not null check (quantity > 0),
  filled_quantity       numeric(20, 6) not null default 0 check (filled_quantity >= 0),
  trigger_price         numeric(20, 6) not null check (trigger_price > 0),
  limit_price           numeric(20, 6) not null,
  projected_target      numeric(20, 6) not null,
  projected_stop        numeric(20, 6) not null check (projected_stop >= 0),
  projected_trailing_stop numeric(20, 6),
  projected_atr         numeric(20, 6),
  trailing_distance     numeric(20, 6),
  expected_holding_days integer not null check (expected_holding_days between 1 and 365),
  signal_as_of          date,
  signal_score          numeric(8, 6),
  projection_snapshot   jsonb not null default '{}'::jsonb,
  placed_on             date not null,
  valid_until           date not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (limit_price >= trigger_price),
  check (projected_target > limit_price),
  check (projected_stop < trigger_price),
  check (valid_until >= placed_on),
  check (filled_quantity <= quantity),
  -- FILLED means fully filled; a cancelled order may keep earlier partial fills.
  check (status <> 'FILLED' or filled_quantity = quantity),
  check (status <> 'PENDING' or filled_quantity < quantity)
);

create index if not exists swing_pending_orders_user_status_idx
  on public.swing_pending_orders(user_id, market, status, placed_on desc);

-- One live buy-stop per user and stock.
create unique index if not exists swing_pending_orders_one_pending_idx
  on public.swing_pending_orders(user_id, asset_id) where status = 'PENDING';

create table if not exists public.swing_pending_order_fills (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.swing_pending_orders(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  -- Nulled if the user later deletes that ledger trade; the fill stays as order history.
  trade_id     uuid references public.swing_trade_ledger(id) on delete set null,
  filled_on    date not null,
  fill_price   numeric(20, 6) not null check (fill_price > 0),
  quantity     numeric(20, 6) not null check (quantity > 0),
  created_at   timestamptz not null default now()
);

create index if not exists swing_pending_order_fills_order_idx
  on public.swing_pending_order_fills(order_id, filled_on);
