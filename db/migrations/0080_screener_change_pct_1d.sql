alter table public.screener_technical_daily
  add column if not exists change_pct_1d numeric(12, 4);

comment on column public.screener_technical_daily.change_pct_1d is
  'Point-in-time close-to-close percentage change from the previous completed session; calculated by the Python screener feature pipeline.';
