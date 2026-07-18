# Stock Screener

A Kite-style fundamental + price-action screener over US and Indian equities. It
reuses the existing stack — Next.js 16 (App Router), local Postgres via `pg`,
cookie-session auth, and the yfinance data pipelines — and adds a materialised
read model, a composable filter engine, presets, saved screens, and a dashboard
widget.

Route: **`/screener`**. (The former `/screener` swing redirect now lives at
`/swing-candidates`; the per-market swing screener is unchanged at
`/terminal/<market>/screener`.)

## Architecture

```
daily_ohlcv ─┐
latest_quotes ├─ refresh job ─▶ public.stock_snapshot ─▶ /api/screener ─▶ /screener UI
latest_financials ┘   (lib/screener/snapshot.ts)        (filter engine)     (+ widget)
```

- **`public.stock_snapshot`** — one row per tracked stock (deduped to one listing
  per symbol per market), rebuilt on a schedule. Price-action fields (52-week
  high/low, gap %, intraday volatility, trade value) are derived from OHLC
  history; fundamentals come from `latest_financials`.
- **Filter engine** (`lib/screener/filterEngine.ts`) — `{field, op, value}`
  clauses combined with AND. One set of operator + null semantics drives both an
  in-memory evaluator (tests, widget) and a parameterised SQL builder (server).
  NULL never satisfies a numeric comparison — the row is excluded, not treated
  as 0.
- **Field registry** (`lib/screener/fields.ts`) — the whitelist of screenable
  columns and their labels/formats. The SQL builder only references columns from
  here, so there is no injection surface.

## Data provenance

| Field | Source |
|---|---|
| LTP, % change | `latest_quotes` (falls back to last OHLC close) |
| Volume, trade value, 52W high/low, gap %, intraday vol % | **derived** from `daily_ohlcv` |
| Market cap, P/E, ROE, D/E, dividend yield, free cash flow, sector | **yfinance** `.info` via the fundamentals pipelines |
| ROCE, revenue/profit growth YoY | derived in the reports pipeline |

`lib/screener/provider.ts` documents this and defines the `FundamentalsProvider`
interface — swap in a paid vendor (e.g. Financial Modeling Prep) by adding one
implementation.

Money fields are **Rs. Crore** for INR rows and **USD millions** for USD rows;
the UI formats per-row by currency.

## Setup

### 1. Migrate + seed

```bash
psql "$DATABASE_URL" -f db/migrations/0012_stock_screener.sql
DATABASE_URL=... node scripts/seed-universes.mjs      # Nifty 50/100/500, F&O, S&P 500
```

### 2. Populate fundamentals (real sources)

The yfinance pipelines write market cap, P/E, ROE, debt/equity, dividend yield,
free cash flow, and sector into `asset_financial_reports` / `assets.sector`:

```bash
npm run sync:fundamentals          # India (NSE/BSE)
npm run sync:us-fundamentals       # US
# bounded to a universe:
DATABASE_URL=... .venv/bin/python pipelines/stock_fundamentals_sync.py \
  --symbols "$(psql "$DATABASE_URL" -tAc "select string_agg(symbol,',') from universe_members where universe='NIFTY_500'")" --force
```

Missing a fundamental for some names is expected — yfinance coverage is uneven.
Those fields render as "—" and are excluded from numeric filters. To wire a
different/paid source, implement `FundamentalsProvider` and populate the same
columns.

### 3. Refresh the snapshot

The screener reads `stock_snapshot`, which must be rebuilt after data changes.

A full rebuild is ~2.5s for ~15k rows and is idempotent, so over-refreshing is
cheap and safe.

- **Manual:** `DATABASE_URL=... node scripts/refresh-screener.mjs [US|IN]`

- **Scheduled (local / macOS — installed):** a launchd agent runs
  `scripts/refresh-screener-cron.sh` every 15 minutes. The wrapper sources
  `DATABASE_URL` from `.env.local` at run time (so no credential is duplicated
  into the plist) and hits Postgres directly — it does **not** need the Next
  server running.

  ```bash
  # install / start
  launchctl load -w ~/Library/LaunchAgents/com.investogenie.screener-refresh.plist
  # stop / remove
  launchctl unload -w ~/Library/LaunchAgents/com.investogenie.screener-refresh.plist
  # status + logs
  launchctl list | grep screener
  tail -f ~/Library/Logs/investogenie-screener-refresh.log
  ```

- **Scheduled (deployed):** `GET /api/cron/refresh-screener` (optional
  `?market=US|IN`), gated by `CRON_SECRET`. Registered in `vercel.json` as
  `*/15 3-10,13-21 * * 1-5` (UTC) — every 15 min on weekdays across **both**
  sessions: 03:00–10:45 UTC covers the NSE day (09:15–15:30 IST) and
  13:00–21:45 UTC covers US regular hours.

## Universes

Static JSON lists in `db/universes/` (`nifty_50`, `nifty_100`, `nifty_500`,
`fno`, `sp_500`). Each file records its `source` URL. To refresh membership,
re-download from source and re-run `scripts/seed-universes.mjs`:

- Nifty 50/100/500 — `https://niftyindices.com/IndexConstituent/ind_nifty{50,100,500}list.csv`
- F&O — `https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv`
- S&P 500 — `https://github.com/datasets/s-and-p-500-companies`

"All stocks" is implicit (every tracked stock) and needs no membership rows.

## Presets

Declarative filter/sort combinations in `lib/screener/presets.ts` — price action
(gainers, losers, near 52W high/low, gap up/down, high volatility, most active by
volume/value) and fundamentals (high growth, quality, value, low debt, dividend
payers, SEBI large/mid/small caps by market-cap rank). "Value" (P/E below the
**sector median**) is resolved server-side with a per-sector median join.

## Saved screens

Per-user, in `public.saved_screens`. Save the current market + universe +
filters + sort + columns under a name; reopen, rename, delete. Server actions in
`app/screener/actions.ts`.

## Tests

Filter-engine unit tests (operators, AND composition, null edge cases,
validation, SQL generation, sort):

```bash
npm test
```
