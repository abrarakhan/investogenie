# Trend Continuation module

- Owns multi-session impulse/continuation observation and confirmed day-two execution safety.
- Server: `lib/trendContinuation.ts`.
- Python: `pipelines/trend_continuation.py`, `pipelines/strategy_math/trend_execution.py`.
- Table: `trend_continuation_signals`; execution plans share the protected plan boundary.
- Observation-only states must never unlock buying or auto-buy.
- Mobile target: full gate detail and only the same server-authorized actions as web.
- Focused checks: `pipelines/test_trend_continuation.py` and trend execution tests.
