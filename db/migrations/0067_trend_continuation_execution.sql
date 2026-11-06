-- Allow confirmed day-two Trend Continuation signals to use the immutable
-- manual execution-plan workflow. Auto-buy remains intentionally unsupported.
alter table public.swing_execution_plans
  drop constraint if exists swing_execution_plans_strategy_key_check;
alter table public.swing_execution_plans
  add constraint swing_execution_plans_strategy_key_check
  check (strategy_key in ('STRONG_SWING','MOMENTUM_IGNITION','TREND_CONTINUATION'));
