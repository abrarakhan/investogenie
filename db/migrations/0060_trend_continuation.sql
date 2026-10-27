create table if not exists public.trend_continuation_signals (
  id bigserial primary key,
  asset_id uuid not null references public.assets(id) on delete cascade,
  ticker text not null,
  name text,
  market text not null default 'IN' check (market='IN'),
  asof_market_date date not null,
  status text not null check (status in ('IMPULSE_DETECTED','CONTINUATION_WATCH','TREND_CONTINUATION_READY','EXTENDED_RISK')),
  ready boolean not null default false,
  observation_only boolean not null default true check (observation_only),
  score integer not null check (score between 0 and 100),
  entry numeric,
  stop numeric,
  target numeric,
  metrics jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  feature_version text not null,
  computed_at timestamptz not null default now(),
  unique(asset_id,asof_market_date,feature_version)
);
create index if not exists trend_continuation_latest_idx
  on public.trend_continuation_signals(market,asof_market_date desc,score desc);

alter table public.mobile_candidate_alert_state drop constraint if exists mobile_candidate_alert_state_engine_check;
alter table public.mobile_candidate_alert_state add constraint mobile_candidate_alert_state_engine_check
  check (engine in ('STRONG_SWING','MOMENTUM_IGNITION','MOMENTUM_IGNITION_V2','TREND_CONTINUATION'));
alter table public.candidate_signal_observations drop constraint if exists candidate_signal_observations_engine_check;
alter table public.candidate_signal_observations add constraint candidate_signal_observations_engine_check
  check (engine in ('STRONG_SWING','MOMENTUM_IGNITION','MOMENTUM_IGNITION_V2','TREND_CONTINUATION'));
