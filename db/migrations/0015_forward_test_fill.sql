-- Forward test: model a swing call as a PENDING order at its trigger.
--
-- A swing signal is a resting order at an entry trigger, not a market buy at
-- spot. Starting the clock at spot credited the strategy with fills it never
-- got, and left target/stop (derived from the trigger) anchored to a different
-- price than entry_price — which is how a long ended up with a stop above entry.
alter table public.forward_test_positions
  add column if not exists trigger_price numeric(20, 4),
  add column if not exists filled_on     date,
  add column if not exists fill_window_days integer not null default 10;

-- status now: PENDING -> OPEN -> TARGET_HIT|STOP_HIT|EXPIRED, or PENDING -> UNFILLED
comment on column public.forward_test_positions.status is
  'PENDING (awaiting trigger fill) | OPEN | TARGET_HIT | STOP_HIT | EXPIRED | UNFILLED';

create index if not exists fwd_test_pending_idx
  on public.forward_test_positions (status) where status = 'PENDING';

-- Scorecard: only graded (filled + closed) calls count toward accuracy, but
-- surface the unfilled rate — a strategy whose triggers never fill is not
-- "accurate", it is untradeable.
drop view if exists public.forward_test_scorecard;
create view public.forward_test_scorecard as
  select
    method, market,
    count(*)                                                           as total,
    count(*) filter (where status = 'PENDING')                         as pending_positions,
    count(*) filter (where status = 'OPEN')                            as open_positions,
    count(*) filter (where status = 'UNFILLED')                        as unfilled_positions,
    count(*) filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')) as closed_positions,
    count(*) filter (where status = 'TARGET_HIT')                      as target_hits,
    count(*) filter (where status = 'STOP_HIT')                        as stop_hits,
    round(avg(case when status in ('TARGET_HIT','STOP_HIT','EXPIRED')
                   then case when realized_return_pct > 0 then 100.0 else 0.0 end end), 2) as win_rate_pct,
    round(avg(realized_return_pct) filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')), 4) as avg_realized_pct,
    round(avg(projected_return_pct) filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')), 4) as avg_projected_pct,
    round(avg(realized_return_pct - projected_return_pct)
            filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED') and projected_return_pct is not null), 4) as avg_projection_error_pct,
    round(avg(max_adverse_pct) filter (where status in ('TARGET_HIT','STOP_HIT','EXPIRED')), 4) as avg_max_adverse_pct,
    round(100.0 * avg(case when within_projected_band then 1.0 else 0.0 end)
            filter (where within_projected_band is not null), 2) as band_coverage_pct
  from public.forward_test_positions
  group by method, market;
