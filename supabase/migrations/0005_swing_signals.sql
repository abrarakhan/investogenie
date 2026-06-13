-- Precomputed swing-classifier output, one row per scanned instrument. The scan
-- job writes here; the screener reads here. This decouples (expensive) signal
-- computation from page rendering so the screener scales to the full universe.

create table if not exists public.swing_signals (
  asset_id          uuid primary key references public.assets (id) on delete cascade,
  ticker            text,
  country           text,
  exchange          text,
  asset_class       text,
  verdict           text,
  score             numeric(5, 4),
  last_close        numeric(20, 6),
  bandwidth_pct     numeric(10, 4),
  is_squeeze        boolean,
  is_breakout       boolean,
  is_long_buildup   boolean,
  reason            text,
  as_of             date,
  computed_at       timestamptz not null default now()
);

create index if not exists swing_signals_verdict_idx on public.swing_signals (verdict);
create index if not exists swing_signals_score_idx on public.swing_signals (score desc);
create index if not exists swing_signals_country_idx on public.swing_signals (country);

alter table public.swing_signals enable row level security;

drop policy if exists "public read swing_signals" on public.swing_signals;
create policy "public read swing_signals"
  on public.swing_signals for select
  to anon, authenticated
  using (true);
