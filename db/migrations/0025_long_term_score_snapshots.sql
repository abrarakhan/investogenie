-- Daily point-in-time observations for validating Long-Term Candidate rankings.
-- Rows are system-level (not user portfolio data) and idempotent per
-- asset/strategy/day. Future-return views use current quotes only for monitoring;
-- research backtests must still use historical point-in-time prices.

create table if not exists public.long_term_score_snapshots (
  asset_id             uuid not null references public.assets(id) on delete cascade,
  market               text not null check (market in ('IN', 'US')),
  strategy_key         text not null,
  rank                 integer not null check (rank > 0),
  score                numeric(6, 2) not null,
  raw_score            numeric(6, 2) not null,
  confidence           numeric(6, 2) not null,
  price                numeric(20, 6),
  fundamentals_period  date,
  metrics              jsonb not null default '{}'::jsonb,
  captured_on          date not null default current_date,
  created_at           timestamptz not null default now(),
  primary key (asset_id, strategy_key, captured_on)
);

create index if not exists long_term_snapshots_strategy_date_idx
  on public.long_term_score_snapshots (strategy_key, captured_on desc, rank);

create or replace view public.long_term_forward_performance as
select s.asset_id, a.ticker, s.market, s.strategy_key, s.captured_on,
       s.rank, s.score, s.confidence, s.price entry_price,
       q.price current_price,
       case when s.price > 0 and q.price is not null
            then (q.price - s.price) / s.price * 100 end return_pct,
       current_date - s.captured_on holding_days,
       s.fundamentals_period
  from public.long_term_score_snapshots s
  join public.assets a on a.id = s.asset_id
  left join public.latest_quotes q on q.asset_id = s.asset_id;
