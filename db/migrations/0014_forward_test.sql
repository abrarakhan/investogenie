-- =============================================================================
-- Forward testing (out-of-sample paper trading).
--
-- Each row is ONE prediction, frozen at the moment it was made. The projection
-- columns are written once at enrollment and are never recomputed — that is the
-- whole point. Swing verdicts and probability scores change every scan, so
-- re-deriving a projection at evaluation time would silently grade the model
-- against a forecast it only made in hindsight.
--
-- Deliberately separate from public.holdings / trades: a forward test must not
-- pollute the user's actual paper portfolio, and it is system-owned rather than
-- user-owned (user_id is nullable so a shared/global test can run headless).
-- =============================================================================

create table if not exists public.forward_test_positions (
  id                     uuid primary key default gen_random_uuid(),

  -- Which engine produced this call. 'SWING:<STRATEGY_KEY>' (one bucket per
  -- legendary strategy) or 'PROBABILITY'.
  method                 text not null,
  market                 text not null,                       -- 'US' | 'IN'
  asset_id               uuid not null references public.assets (id) on delete cascade,
  ticker                 text not null,
  user_id                uuid references public.users (id) on delete cascade,

  enrolled_at            timestamptz not null default now(),
  enrolled_on            date not null default current_date,
  horizon_days           integer not null,
  direction              text not null default 'LONG',        -- 'LONG' | 'SHORT'

  -- ---- Frozen projection. Write once at enrollment, never update. ----------
  entry_price            numeric(20, 4) not null,
  projected_target       numeric(20, 4),
  projected_stop         numeric(20, 4),
  projected_return_pct   numeric(12, 4),   -- swing: to target; probability: median
  projected_prob_up_pct  numeric(10, 4),   -- probability method only
  projected_p5_pct       numeric(12, 4),   -- probability method: band floor
  projected_p95_pct      numeric(12, 4),   -- probability method: band ceiling
  -- Full engine output at enrollment, for audit and later re-scoring.
  projection             jsonb not null default '{}'::jsonb,

  -- ---- Realised outcome. Written by the evaluator. -------------------------
  status                 text not null default 'OPEN',        -- OPEN|TARGET_HIT|STOP_HIT|EXPIRED
  evaluated_through      date,
  closed_at              timestamptz,
  exit_price             numeric(20, 4),
  realized_return_pct    numeric(12, 4),
  -- Path statistics: a call can be "right" on direction yet unusable if it drew
  -- down hard first, so track both extremes over the holding period.
  max_favorable_pct      numeric(12, 4),
  max_adverse_pct        numeric(12, 4),
  -- Did the outcome land inside the projected p5..p95 band? Null until closed.
  within_projected_band  boolean,

  updated_at             timestamptz not null default now(),

  -- One live call per method+asset at a time; re-enrolling after close is fine.
  unique (method, asset_id, enrolled_on)
);

create index if not exists fwd_test_open_idx
  on public.forward_test_positions (status, market) where status = 'OPEN';
create index if not exists fwd_test_method_idx
  on public.forward_test_positions (method, enrolled_on desc);
create index if not exists fwd_test_asset_idx
  on public.forward_test_positions (asset_id);

-- Per-method scorecard: hit rate, projected-vs-realised, and band calibration.
-- A view keeps the aggregation in one place for both the UI and any CLI check.
create or replace view public.forward_test_scorecard as
  select
    method,
    market,
    count(*)                                                          as total,
    count(*) filter (where status = 'OPEN')                           as open_positions,
    count(*) filter (where status <> 'OPEN')                          as closed_positions,
    count(*) filter (where status = 'TARGET_HIT')                     as target_hits,
    count(*) filter (where status = 'STOP_HIT')                       as stop_hits,
    -- Directional accuracy over closed calls only.
    round(avg(case when status <> 'OPEN'
                   then case when realized_return_pct > 0 then 100.0 else 0.0 end end), 2) as win_rate_pct,
    round(avg(realized_return_pct) filter (where status <> 'OPEN'), 4) as avg_realized_pct,
    round(avg(projected_return_pct) filter (where status <> 'OPEN'), 4) as avg_projected_pct,
    -- The headline calibration number: realised minus projected. Persistently
    -- positive or negative means the engine is biased, not noisy.
    round(avg(realized_return_pct - projected_return_pct)
            filter (where status <> 'OPEN' and projected_return_pct is not null), 4) as avg_projection_error_pct,
    round(avg(max_adverse_pct) filter (where status <> 'OPEN'), 4)    as avg_max_adverse_pct,
    -- Share of closed calls that landed inside the projected p5..p95 band.
    -- A well-calibrated 90% band should contain ~90% of outcomes.
    round(100.0 * avg(case when within_projected_band then 1.0 else 0.0 end)
            filter (where status <> 'OPEN' and within_projected_band is not null), 2) as band_coverage_pct
  from public.forward_test_positions
  group by method, market;
