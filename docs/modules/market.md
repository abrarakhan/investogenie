# Market module

The Market module is the dashboard a user lands on: index levels, market breadth, movers, their own
recorded positions, and a summary of what each strategy engine is currently saying. It reads from the
stored quote, daily history and signal tables rather than computing anything itself.

The rule that matters: presentation may not reclassify a setup. If the Python engine called a stock
extended, the dashboard shows it as extended.

## Boundaries and invariants

- Owns market overview, indices, breadth, movers, recorded positions and dashboard engine summaries.
- Web entry: `app/terminal/[market]/page.tsx`.
- Server entry: `lib/marketOverview.ts`, `lib/engines-runtime.ts`.
- Reads `latest_quotes`, `daily_ohlcv`, `swing_signals` and user ledger/holding records.
- Swing levels come from Python; presentation may not reclassify a setup.
- Mobile target: lightweight overview endpoint with independently cached sections.
- Focused checks: market overview tests, engine runtime tests, typecheck.
