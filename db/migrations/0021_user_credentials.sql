-- Encrypted user credentials storage for API keys and sensitive settings

create table if not exists public.user_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  -- SMTP credentials (encrypted)
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_password_encrypted text,  -- AES-256-GCM encrypted
  -- AI provider API keys (encrypted)
  anthropic_api_key_encrypted text,  -- Claude
  openai_api_key_encrypted text,     -- OpenAI / GPT
  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_credentials_user_id_idx on public.user_credentials (user_id);
