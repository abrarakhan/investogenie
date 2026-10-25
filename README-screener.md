# Stock Screener

_Source reviewed 25 October 2026 at main revision `42eea8f`._

The fundamental and price-action Stock Screener lives at `/terminal/in/stocks` and
`/terminal/us/stocks`. The `/terminal/[market]/screener` route is the separate buy-side Swing
Candidates workspace. There is no current top-level `/screener` page in the route tree.

## Data flow

```text
daily_ohlcv + latest_quotes + latest_financials
  -> lib/screener/snapshot.ts
  -> public.stock_snapshot
  -> lib/screener/service.ts / api/screener
  -> components/stock-screener/StockScreener.tsx
```

The snapshot is a persisted read model with one selected listing per symbol/market. Quote/price
fields use latest quotes and historical bars; fundamentals come from normalized financial reports.
Missing numeric values do not satisfy numeric comparisons.

`lib/screener/fields.ts` whitelists columns, labels and formats. The filter engine validates
`{field, op, value}` clauses, combines them with AND and produces parameterized SQL. Presets define
filter/sort combinations; sector-median value selection is resolved on the server.

Money displays use INR crore or USD millions according to row currency. Provider completeness
varies; missing fields render as unavailable rather than invented zero values.

## Setup and refresh

Apply the ordered schema, including `0012_stock_screener.sql`. Seed membership and ingest the
required data with the configured database environment:

```bash
node scripts/seed-universes.mjs
npm run sync:fundamentals
npm run sync:us-fundamentals
node scripts/refresh-screener.mjs IN
node scripts/refresh-screener.mjs US
```

Python package scripts expect `.venv/bin/python`. Latest quotes and OHLCV must also be populated
for meaningful price-action screens.

`GET /api/cron/refresh-screener` supports a market selection and cron authorization.
`vercel.json` registers `*/15 3-10,13-21 * * 1-5` UTC. The repository also contains the direct
database refresh script and a macOS cron wrapper; their presence does not establish that a
launchd job is installed on a particular host. Verify your actual refresh mechanism and avoid
unintentionally running competing schedules.

## Universes and saved screens

Static memberships are in `db/universes/` for Nifty 50/100/500, F&O and S&P 500. Re-seed after
updating the source lists. ALL uses the tracked stock universe.

Saved screens are per-user rows in `public.saved_screens`, managed by
`lib/screener-actions.ts`: save, reopen, rename and delete market/universe/filter/sort/column
configuration. Signed-in users can also add stocks to their default watchlist.

## Natural-language filters

The signed-in action `parseScreenIntent()` resolves active provider configuration through
`getActiveAIConfig()`. Anthropic, OpenAI, Google and DeepSeek dispatch is implemented in
`lib/screener/nlQuery.ts`. Input is trimmed to 500 characters. Schema validation, filter
validation and sanitization constrain output; the model does not supply arbitrary SQL.
Configuration and provider errors surface to the caller.

This screener does not change Strong Swing, Armed Swing, Momentum or ML ranking rules and does
not place broker orders.

## Validation

`npm test` includes filter-engine and natural-language validation tests. Snapshot/database checks
need a configured PostgreSQL instance; provider-backed AI calls require valid credentials.
See [architecture](ARCHITECTURE.md) and [credentials](docs/SECURE_CREDENTIALS.md).
