-- Audit of every cancel or change the user asks the app to make to one of their
-- own open broker orders. The row is written before the broker is called, so an
-- attempt is on record even if the request then fails or the process dies.
create table if not exists public.breeze_order_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null check (action in ('CANCEL','MODIFY')),
  order_id text not null,
  exchange_code text not null,
  stock_code text,
  order_before jsonb not null,
  requested jsonb,
  status text not null check (status in ('PENDING','DONE','REJECTED','ERROR')),
  broker_response jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists breeze_order_actions_user_created_idx
  on public.breeze_order_actions (user_id, created_at desc);
