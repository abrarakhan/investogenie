create table if not exists public.user_news_providers (
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check(provider in ('alpha_vantage','gnews','newsapi','marketaux')),
  api_key_encrypted text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(user_id,provider)
);

insert into public.user_news_providers(user_id,provider,api_key_encrypted)
select user_id,news_provider,news_api_key_encrypted from public.user_credentials
where news_provider in ('alpha_vantage','gnews','newsapi','marketaux') and news_api_key_encrypted is not null
on conflict(user_id,provider) do nothing;
