-- Active AI provider selection for the natural-language screener.
-- Replaces the fixed anthropic/openai key columns with a single chosen provider,
-- model, and encrypted key. The old columns are kept for backward compatibility
-- but are no longer read by the app.

alter table public.user_credentials
  add column if not exists ai_provider text,
  add column if not exists ai_model text,
  add column if not exists ai_api_key_encrypted text;  -- AES-256-GCM encrypted

-- One-time migration: if a user previously stored an Anthropic key, adopt it as
-- the active provider so NL queries keep working after the upgrade.
update public.user_credentials
   set ai_provider = 'anthropic',
       ai_model = 'claude-opus-4-8',
       ai_api_key_encrypted = anthropic_api_key_encrypted
 where anthropic_api_key_encrypted is not null
   and ai_api_key_encrypted is null;
