alter table public.daily_ohlcv
  add column if not exists source text;

comment on column public.daily_ohlcv.source is
  'Provider that most recently supplied the candle; Breeze rows are protected from fallback overwrites.';
