-- Automatic Gmail processing for NSDL/CAMS/KFintech CAS statements and AMC
-- monthly portfolio disclosures. Attachment bytes are never persisted.

alter table public.gmail_connections
  add column if not exists cas_pdf_password_encrypted text,
  add column if not exists auto_import_enabled boolean not null default true;

alter table public.user_credentials
  add column if not exists gmail_client_id_encrypted text,
  add column if not exists gmail_client_secret_encrypted text;

comment on column public.user_credentials.gmail_client_secret_encrypted is
  'AES-256-GCM encrypted Google OAuth web-client secret configured by the user';

alter table public.gmail_disclosure_attachments
  add column if not exists document_type text not null default 'amc_disclosure',
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_completed_at timestamptz;

alter table public.gmail_disclosure_attachments
  drop constraint if exists gmail_disclosure_attachments_status_check;
alter table public.gmail_disclosure_attachments
  add constraint gmail_disclosure_attachments_status_check
  check (status in ('discovered','processing','imported','needs_password','needs_review','ignored','error'));

alter table public.gmail_disclosure_attachments
  drop constraint if exists gmail_disclosure_attachments_document_type_check;
alter table public.gmail_disclosure_attachments
  add constraint gmail_disclosure_attachments_document_type_check
  check (document_type in ('nsdl_cas','amc_disclosure','unknown'));

create table if not exists public.gmail_attachment_imports (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.gmail_disclosure_attachments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  holding_id uuid references public.holdings (id) on delete set null,
  scheme_code text,
  snapshot_month date,
  row_count integer not null default 0,
  status text not null check (status in ('imported','skipped','error')),
  detail text,
  imported_at timestamptz not null default now(),
  unique (attachment_id, holding_id, snapshot_month)
);

create index if not exists gmail_attachment_imports_user_idx
  on public.gmail_attachment_imports (user_id, imported_at desc);
