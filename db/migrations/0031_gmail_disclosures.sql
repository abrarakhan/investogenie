-- Read-only Gmail connector for discovering AMC monthly portfolio attachments.
-- Attachment bodies are never persisted; only metadata and import audit state.
create table if not exists public.gmail_connections (
  user_id                   uuid primary key references public.users (id) on delete cascade,
  gmail_email               text not null,
  access_token_encrypted    text not null,
  refresh_token_encrypted   text,
  token_expires_at          timestamptz,
  scope                     text not null,
  connected_at              timestamptz not null default now(),
  last_scan_at              timestamptz,
  updated_at                timestamptz not null default now()
);

create table if not exists public.gmail_oauth_states (
  state_hash    text primary key,
  user_id       uuid not null references public.users (id) on delete cascade,
  redirect_uri  text not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists gmail_oauth_states_expiry_idx on public.gmail_oauth_states (expires_at);

create table if not exists public.gmail_disclosure_attachments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  message_id          text not null,
  attachment_id       text,
  part_id             text not null,
  filename            text not null,
  mime_type           text,
  size_bytes          integer not null default 0,
  email_subject       text,
  sender              text,
  received_at         timestamptz,
  inferred_amc        text,
  status              text not null default 'discovered'
                        check (status in ('discovered','imported','ignored','error')),
  matched_holding_id  uuid references public.holdings (id) on delete set null,
  snapshot_month      date,
  imported_at         timestamptz,
  error_message       text,
  discovered_at       timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, message_id, part_id)
);
create index if not exists gmail_disclosures_user_status_idx
  on public.gmail_disclosure_attachments (user_id, status, received_at desc);
