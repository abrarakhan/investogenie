create table if not exists public.browser_notification_events (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  market text not null check (market in ('IN','US')),
  kind text not null check (kind in ('CANDIDATE_READY','TRADE_ACTION')),
  asset_id uuid references public.assets(id) on delete cascade,
  trade_id uuid references public.swing_trade_ledger(id) on delete cascade,
  title text not null,
  body text not null,
  route text not null,
  signature text not null,
  created_at timestamptz not null default now()
);
create index if not exists browser_notification_events_user_id_idx
  on public.browser_notification_events(user_id,id desc);

