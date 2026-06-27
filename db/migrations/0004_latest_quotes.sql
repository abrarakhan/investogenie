-- Universe-wide latest price: one row per instrument, refreshed by the quote
-- ingestion job. Kept separate from daily_ohlcv (which holds full history for a
-- subset) so a single snapshot price can be stored for every listed name.

create table if not exists public.latest_quotes (
  asset_id    uuid primary key references public.assets (id) on delete cascade,
  price       numeric(20, 6) not null,
  change_pct  numeric(12, 4),
  currency    text,
  as_of       date,
  source      text,            -- 'NASDAQ', 'NSE_INDEX', 'DIRECT_QUOTE', 'NSE_BHAVCOPY', 'BSE_BHAVCOPY', 'GOOGLE_FINANCE'
  updated_at  timestamptz not null default now()
);

create index if not exists latest_quotes_as_of_idx on public.latest_quotes (as_of desc);
