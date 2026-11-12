-- Live order updates pushed by Breeze for the system owner's account. This is an
-- append-only log beside the periodic account reconciliation (breeze_broker_snapshots),
-- which stays the record of the account's state. An update is stored once per
-- order, status and filled quantity.
create table if not exists public.breeze_order_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  order_reference text not null,
  status text not null,
  exchange_code text,
  stock_code text,
  asset_id uuid references public.assets(id) on delete set null,
  action text,
  quantity numeric,
  executed_quantity numeric,
  average_price numeric,
  limit_price numeric,
  raw_data jsonb not null,
  received_at timestamptz not null default now()
);

create unique index if not exists breeze_order_events_once_uidx
  on public.breeze_order_events (user_id, order_reference, status, coalesce(executed_quantity, -1));
create index if not exists breeze_order_events_user_received_idx
  on public.breeze_order_events (user_id, received_at desc);

alter table public.browser_notification_events
  drop constraint if exists browser_notification_events_kind_check;
alter table public.browser_notification_events
  add constraint browser_notification_events_kind_check
  check (kind in ('CANDIDATE_READY','CANDIDATE_WATCH','TRADE_ACTION','ORDER_UPDATE'));
