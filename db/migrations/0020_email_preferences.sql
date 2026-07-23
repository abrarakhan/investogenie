-- Email digest preferences for daily morning stock alerts

create table if not exists public.email_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  enabled boolean not null default false,
  email text not null,
  send_time text not null default '07:00', -- HH:MM in IST
  include_swing_candidates boolean not null default true,
  include_probability boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_preferences_user_id_idx on public.email_preferences (user_id);
create index if not exists email_preferences_enabled_idx on public.email_preferences (enabled);
