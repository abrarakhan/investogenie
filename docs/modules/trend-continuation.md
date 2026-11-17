# Trend Continuation module

- Owns multi-session impulse/continuation observation and confirmed day-two execution safety.
- Public boundary: `features/trend-continuation/service.ts` and `features/trend-continuation/contracts.ts`.
- Transitional server implementation: `lib/trendContinuation.ts`.
- Python: `pipelines/trend_continuation.py`, `pipelines/strategy_math/trend_execution.py`.
- Table: `trend_continuation_signals`; execution plans share the protected plan boundary.
- Observation-only states must never unlock buying or auto-buy.
- Mobile target: full gate detail and only the same server-authorized actions as web.
- The recurring scan assesses ~2,940 stocks and shares two CPUs with request rendering. It runs
  every 15 minutes with a 600s cap (`TREND_CONTINUATION_INTERVAL_MINUTES`,
  `TREND_CONTINUATION_TIMEOUT_MS`). It previously ran every 120s with a 110s cap, which it could
  not meet: every run was killed and restarted 10s later, holding a CPU all session. Any change
  here must leave the CPU free between runs and allow a run to finish.
- Focused checks: `pipelines/test_trend_continuation.py` and trend execution tests.
