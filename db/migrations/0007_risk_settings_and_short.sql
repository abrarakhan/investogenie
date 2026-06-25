-- Per-user risk settings + raw fields for read-time level derivation (long/short).

-- Raw setup fields so entry/target/stop/trail can be re-derived per user without
-- a rescan; plus the trade direction (bias).
alter table public.swing_signals
  add column if not exists bias           text,
  add column if not exists long_trigger   numeric(20, 6),
  add column if not exists short_trigger  numeric(20, 6),
  add column if not exists hh22           numeric(20, 6),
  add column if not exists ll22           numeric(20, 6),
  add column if not exists daily_velocity numeric(20, 6);

-- Per-user risk parameters. Defaults match DEFAULT_RISK in the classifier, so a
-- user with no row gets the standard 1.5×ATR stop / 2:1 R:R / 3×ATR trail.
create table if not exists public.user_swing_settings (
  user_id        uuid primary key references public.users (id) on delete cascade,
  stop_atr_mult  numeric(6, 3) not null default 1.5,
  target_rr      numeric(6, 3) not null default 2.0,
  trail_atr_mult numeric(6, 3) not null default 3.0,
  include_short  boolean not null default true,
  updated_at     timestamptz not null default now()
);
