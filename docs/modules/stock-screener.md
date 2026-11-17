# Stock Screener module

The Stock Screener is general-purpose filtering over the whole universe: arbitrary fundamental and
technical conditions, saved screens, preset universes, CSV and Excel export, and historical backtests
of a filter set. It also accepts natural-language intent, which is translated into filters and then
validated against a whitelist and sanitised - generated text never becomes arbitrary SQL.

It is easy to confuse with Swing Candidates, and the two are unrelated: this is at
`/terminal/[market]/stocks`, while `/terminal/[market]/screener` is the Swing engine's output.

## Boundaries and invariants

- Owns arbitrary fundamental/technical filters, saved screens, natural-language intent and historical backtests.
- Web entry: `app/terminal/[market]/stocks/page.tsx`; APIs: `/api/screener`, `/api/screener/backtest`.
- Server: `lib/screener/`; Python features: `pipelines/screener_technical_features.py`.
- PostgreSQL stores point-in-time features and performs parameterized filtering/aggregation.
- Do not confuse this module with Swing Candidates at `/terminal/[market]/screener`.
- Mobile target: paginated filters/results and saved screens; no full-universe payload.
- Focused checks: `lib/screener/*.test.ts`, `pipelines/test_screener_technical_features.py`.
