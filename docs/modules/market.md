# Market module

- Owns market overview, indices, breadth, movers, recorded positions and dashboard engine summaries.
- Web entry: `app/terminal/[market]/page.tsx`.
- Server entry: `lib/marketOverview.ts`, `lib/engines-runtime.ts`.
- Reads `latest_quotes`, `daily_ohlcv`, `swing_signals` and user ledger/holding records.
- Swing levels come from Python; presentation may not reclassify a setup.
- Mobile target: lightweight overview endpoint with independently cached sections.
- Focused checks: market overview tests, engine runtime tests, typecheck.
