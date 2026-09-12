-- Link-only AMC portfolio emails. URLs can contain recipient-specific tracking
-- tokens, so they are encrypted with the same application credential key.

alter table public.gmail_disclosure_attachments
  add column if not exists source_kind text not null default 'attachment',
  add column if not exists source_url_encrypted text;

alter table public.gmail_disclosure_attachments
  drop constraint if exists gmail_disclosure_attachments_source_kind_check;
alter table public.gmail_disclosure_attachments
  add constraint gmail_disclosure_attachments_source_kind_check
  check (source_kind in ('attachment','link'));

comment on column public.gmail_disclosure_attachments.source_url_encrypted is
  'AES-256-GCM encrypted trusted AMC/CAMS/KFintech disclosure download URL';
