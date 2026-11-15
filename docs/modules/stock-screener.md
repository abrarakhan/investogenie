# Stock Screener module

- Owns arbitrary fundamental/technical filters, saved screens, natural-language intent and historical backtests.
- Web entry: `app/terminal/[market]/stocks/page.tsx`; APIs: `/api/screener`, `/api/screener/backtest`.
- Server: `lib/screener/`; Python features: `pipelines/screener_technical_features.py`.
- PostgreSQL stores point-in-time features and performs parameterized filtering/aggregation.
- Do not confuse this module with Swing Candidates at `/terminal/[market]/screener`.
- Mobile target: paginated filters/results and saved screens; no full-universe payload.
- Focused checks: `lib/screener/*.test.ts`, `pipelines/test_screener_technical_features.py`.
