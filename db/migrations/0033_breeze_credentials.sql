alter table public.user_credentials
  add column if not exists breeze_api_key_encrypted text,
  add column if not exists breeze_api_secret_encrypted text,
  add column if not exists breeze_session_token_encrypted text,
  add column if not exists breeze_session_updated_at timestamptz;

comment on column public.user_credentials.breeze_session_token_encrypted is
  'AES-256-GCM encrypted ICICI Breeze daily session token';
