alter table public.news_articles
  add column if not exists canonical_url text,
  add column if not exists content_fingerprint text,
  add column if not exists event_cluster_key text,
  add column if not exists trust_score integer not null default 40,
  add column if not exists corroboration_count integer not null default 1;

alter table public.news_impacts
  add column if not exists verified_evidence boolean not null default false;

create index if not exists news_articles_fingerprint_idx on public.news_articles(content_fingerprint);
create index if not exists news_articles_cluster_idx on public.news_articles(event_cluster_key, published_at desc);

create table if not exists public.news_sources (
  domain text primary key,
  source_name text not null,
  trust_score integer not null check (trust_score between 0 and 100),
  tier text not null check (tier in ('OFFICIAL','PRIMARY','REPUTABLE','OTHER')),
  enabled boolean not null default true,
  reviewed_at timestamptz not null default now()
);

create table if not exists public.news_sync_state (
  provider text not null,
  market text not null check (market in ('IN','US')),
  last_published_at timestamptz,
  last_success_at timestamptz,
  primary key(provider, market)
);

create table if not exists public.event_stock_map (
  event_type text not null,
  symbol text not null,
  market text not null check (market in ('IN','US')),
  direction text not null check (direction in ('POSITIVE','NEGATIVE')),
  strength integer not null check (strength between 0 and 100),
  rationale text not null,
  enabled boolean not null default true,
  primary key(event_type, symbol, market)
);

insert into public.news_sources(domain,source_name,trust_score,tier) values
 ('rbi.org.in','Reserve Bank of India',100,'OFFICIAL'),
 ('sebi.gov.in','SEBI',100,'OFFICIAL'),
 ('nseindia.com','NSE',100,'OFFICIAL'),
 ('bseindia.com','BSE',100,'OFFICIAL'),
 ('federalreserve.gov','Federal Reserve',100,'OFFICIAL'),
 ('reuters.com','Reuters',98,'REPUTABLE'),
 ('bloomberg.com','Bloomberg',98,'REPUTABLE'),
 ('ft.com','Financial Times',95,'REPUTABLE'),
 ('wsj.com','Wall Street Journal',94,'REPUTABLE'),
 ('cnbc.com','CNBC',90,'REPUTABLE'),
 ('economictimes.indiatimes.com','Economic Times',88,'REPUTABLE'),
 ('livemint.com','Mint',88,'REPUTABLE'),
 ('business-standard.com','Business Standard',88,'REPUTABLE')
on conflict(domain) do update set source_name=excluded.source_name,trust_score=excluded.trust_score,tier=excluded.tier;
