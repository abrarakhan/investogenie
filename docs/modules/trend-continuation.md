# Trend Continuation module

Trend Continuation watches for a persistent three-to-five session impulse and asks whether it is
likely to continue or has become extended. It is primarily an observation engine: most of its states
report, and an observation-only state must never unlock buying or auto-buy.

The one actionable path is a confirmed day-two breakout, which may create an immutable manual plan
after live execution and results gates pass. Day one, pullbacks and any automatic buying remain
blocked. Counter-trend rebounds can never become ready, however strong they look.

## Boundaries and invariants

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
- Mid-way momentum (v8, `trend_continuation_v8_midway`) adds three variants over the
  existing engine without replacing it: `STAGE2_IMPULSE` and `EP_REBOUND` take one
  decisive bar, `STAIR_STEP` takes three. The layers are deliberately separable -- the
  mid-way rules can only add a watch candidate or close entries on a spent move, never
  silently remove what the continuation engine found.
- Qualification needs deliverable-quantity evidence (`daily_delivery_metrics`), an
  ignition bar of at least Rs 10 crore, and either a trend regime or the narrow event
  exception: a verified result within seven sessions, delivery at 65%+, and a reclaimed
  rising 20-day EMA, all three together.
- Entries additionally require intraday volume pace against the migration 0077 session
  curve (2.5x for impulses, 1.8x for stair-steps, never before 10:15 IST) and a break of
  the variant's own level. Levels are frozen onto the signal by the scan, not recomputed
  per request.
- Exhaustion (>22% over five sessions, or 14-day RSI >= 80) forces `EXTENDED_RISK`. It can
  only take a candidate away, never create one.
- `pipelines/midway_replay.py` performs a point-in-time next-trigger replay of all three
  variants, freezes the detector's own entry/stop/target, gives stop priority on an
  ambiguous daily bar and deducts configurable costs. Historical EP evidence is
  deliberately limited to recorded RESULTS events because filing taxonomy is not fully
  point-in-time. A replay measures the rule; it does not by itself prove a future edge.
- Forward observation is variant-specific (`ENGINE:MIDWAY_STAGE2`,
  `ENGINE:MIDWAY_EP_REBOUND`, `ENGINE:MIDWAY_STAIR_STEP`) and enrolls every qualified
  persisted candidate rather than the page's display cap.
- Focused checks: `pipelines/test_trend_continuation.py`, `test_midway_momentum.py`,
  `test_midway_replay.py`, `test_trend_execution_pace.py` and trend execution tests.

## Operator commands

Run on the production host after loading `/etc/investogenie/investogenie.env`:

```bash
bash scripts/midway-ops.sh status
bash scripts/midway-ops.sh today
bash scripts/midway-ops.sh replay 2026-09-01 2026-11-17 /tmp/midway-replay.json
bash scripts/midway-ops.sh scorecard
```

`today` refreshes the NSE bhavcopy/delivery source, runs the scheduled Python scan,
enrolls qualified variants for forward observation and prints coverage. NSE delivery is
not supplied by Breeze; a missing exchange file therefore remains fail-closed.
