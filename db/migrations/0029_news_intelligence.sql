-- News and AI event intelligence for the separate News Swing workspace.
-- Articles are global market data. Impacts preserve the exact model/provider
-- provenance used to adjust a technical candidate's rank.

alter table public.user_credentials
  add column if not exists news_provider text,
  add column if not exists news_api_key_encrypted text;

create table if not exists public.news_articles (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null,
  provider_article_id text,
  url                 text not null unique,
  title               text not null,
  description         text,
  source_name         text,
  image_url           text,
  published_at        timestamptz not null,
  fetched_at          timestamptz not null default now(),
  raw_payload         jsonb not null default '{}'::jsonb
);

create index if not exists news_articles_published_idx
  on public.news_articles (published_at desc);

create table if not exists public.news_impacts (
  id               uuid primary key default gen_random_uuid(),
  article_id       uuid not null references public.news_articles (id) on delete cascade,
  market           text not null check (market in ('IN', 'US')),
  asset_id         uuid references public.assets (id) on delete cascade,
  sector           text,
  scope            text not null check (scope in ('MARKET', 'SECTOR', 'ASSET')),
  event_type       text not null,
  direction        text not null check (direction in ('POSITIVE', 'NEGATIVE', 'NEUTRAL')),
  sentiment_score  numeric(6,5) not null check (sentiment_score between -1 and 1),
  confidence       numeric(6,5) not null check (confidence between 0 and 1),
  severity         numeric(6,5) not null check (severity between 0 and 1),
  horizon          text not null check (horizon in ('INTRADAY', 'SWING', 'MEDIUM_TERM')),
  rationale        text not null,
  analysis_source  text not null,
  model            text,
  analyzed_at      timestamptz not null default now(),
  unique (article_id, market, asset_id, sector, scope)
);

create index if not exists news_impacts_market_analyzed_idx
  on public.news_impacts (market, analyzed_at desc);
create index if not exists news_impacts_asset_analyzed_idx
  on public.news_impacts (asset_id, analyzed_at desc) where asset_id is not null;
