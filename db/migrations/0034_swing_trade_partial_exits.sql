-- Preserve every partial or final sale against the original swing trade.
create table if not exists public.swing_trade_exits (
  id          uuid primary key default gen_random_uuid(),
  trade_id    uuid not null references public.swing_trade_ledger (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  sold_on     date not null,
  quantity    numeric(20, 6) not null check (quantity > 0),
  exit_price  numeric(20, 6) not null check (exit_price > 0),
  reason      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists swing_trade_exits_trade_date_idx
  on public.swing_trade_exits (trade_id, sold_on, created_at);
create index if not exists swing_trade_exits_user_idx
  on public.swing_trade_exits (user_id, created_at desc);

comment on table public.swing_trade_exits is
  'Actual partial and final sales recorded against a swing trade ledger entry.';
