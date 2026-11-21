-- Per-user mobile push alert preferences.
create table if not exists public.mobile_alert_preferences (
  user_id               uuid primary key references public.users (id) on delete cascade,
  execution_ready       boolean not null default true,
  midway_setups         boolean not null default true,
  ledger_risk_alerts    boolean not null default true,
  news_high_impact      boolean not null default false,
  quiet_hours_enabled   boolean not null default false,
  updated_at            timestamptz not null default now()
);
