-- Cached stock-level AI movement & filter briefs synthesized during news refresh.
create table if not exists public.news_stock_briefs (
  market           text not null,
  asset_id         uuid not null references public.assets (id) on delete cascade,
  verdict          text not null check (verdict in ('KEEP', 'CAUTION', 'FILTER_OUT')),
  movement_bias    text not null check (movement_bias in ('TAILWIND', 'NEUTRAL', 'HEADWIND', 'EVENT_RISK')),
  summary          text not null,
  catalyst_note    text,
  risk_note        text,
  article_count    integer not null default 0,
  analysis_source  text not null,
  model            text,
  generated_at     timestamptz not null default now(),
  primary key (market, asset_id)
);

create index if not exists news_stock_briefs_market_generated_idx
  on public.news_stock_briefs (market, generated_at desc);
