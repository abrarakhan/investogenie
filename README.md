# InvestoGenie

InvestoGenie is a local-first market intelligence and paper trading terminal for the US and Indian markets. It combines portfolio tracking, live quote refreshes, buy-candidate swing screening, company fundamentals, and market overview pages on top of a local PostgreSQL database.

## Current Status

- Next.js 16 App Router app with React 19.
- Local PostgreSQL replaces Supabase completely.
- Local email/password auth with signed HTTP-only sessions.
- Separate US and India experiences.
- Recurring quote, OHLCV, fundamentals, and swing-scan jobs.
- Yahoo Finance primary sync with Google Finance quote fallback.
- NSE incremental OHLCV sync for Indian stocks.
- US and India company fundamentals sync into a shared reports table.

Current local database coverage from the development machine:

| Dataset | Rows |
| --- | ---: |
| Assets | 18,070 |
| Daily OHLCV bars | 4,304,693 |
| Latest quotes | 17,242 |
| Swing signals | 2,422 |
| Financial reports | 83,443 |
| Cron logs | 91 |

## Main Routes

| Route | Purpose |
| --- | --- |
| `/` | Cinematic landing page with market pivot and ticker tape |
| `/markets/us` | US market overview dashboard |
| `/markets/in` | India market overview dashboard |
| `/terminal/us` | Authenticated US portfolio terminal |
| `/terminal/in` | Authenticated India portfolio terminal |
| `/terminal/us/screener` | US swing candidates |
| `/terminal/in/screener` | India swing candidates |
| `/settings` | Per-user swing risk settings |
| `/login` | Sign in / sign up |

## Product Features

### Landing and Market Overview

- WebGL hero with Three.js and React Three Fiber.
- GSAP kinetic headline and scroll sections.
- US/India market pivot switch.
- Live ticker tape from `latest_quotes`.
- Dedicated US and India market overview pages.
- Quote panels, breadth, normalized performance chart, candidate list, and fundamentals leaders.

### Portfolio Terminal

- Per-user portfolio, holdings, transaction ledger, and watchlist.
- Market-scoped US and India views.
- Currency-aware formatting for USD and INR.
- Benchmark cards:
  - US: SPY, QQQ, DIA
  - India: NIFTY, SENSEX, USDINR
- Trade ticket for buy/sell entries.
- Watchlist add/remove with live quote display.

### Swing Candidates

- Buy-candidate oriented screener.
- India view is NSE-only and capped to the top 20 candidates.
- US view uses the currently available US historical scan set.
- Candidate rows include:
  - current price
  - entry
  - target
  - stop loss
  - trailing stop
  - score
  - expected days
  - verdict
  - strategy tags
  - P/E
  - market cap
  - ROCE
  - profit and sales growth

### Analytics

- Derivative-aided swing classifier using Donchian breakouts, Bollinger squeezes, ATR risk levels, volume, and open-interest signals where available.
- Read-time level derivation so user risk settings apply without rescanning.
- Legendary strategy tags:
  - Qullamaggie
  - Minervini
  - Darvas
  - Paul Tudor Jones
  - Simons mean reversion
- India mutual fund overlap engine.
- Macro correlation engine.

### Fundamentals

- Shared `asset_financial_reports` table for quarterly and annual reports.
- Latest financials view for screener joins.
- India monetary values are normalized to Rs. crore.
- US monetary values are normalized to USD millions.
- Derived metrics include P/E, market cap, ROCE, YoY profit variance, and YoY sales variance.

## Data Sync

The normal app launcher runs recurring data work through:

```bash
npm run dev
```

That command starts Next.js through `scripts/run-with-nse-sync.mjs`, which:

- waits until the local server is reachable,
- runs official NSE bhavcopy OHLCV top-up,
- runs official BSE bhavcopy OHLCV top-up,
- refreshes security listings,
- refreshes latest market quotes from bhavcopy,
- syncs US quotes from Yahoo Finance,
- falls back to Google Finance for unresolved US quotes,
- runs the swing scan,
- starts Indian fundamentals sync,
- starts US fundamentals sync,
- refreshes NSE/BSE latest quotes every 15 minutes during Indian market hours
  (09:15-15:30 IST, Mon-Fri). Tune with
  `INDIA_MARKET_QUOTE_REFRESH_INTERVAL_MINUTES`, or disable with
  `INDIA_MARKET_QUOTE_REFRESH_DISABLED=1`,
- repeats market quote refresh on `MARKET_REFRESH_INTERVAL_MINUTES`,
- schedules the daily NSE/BSE bhavcopy history sync by IST time.

Yahoo/Google history fetches are no longer the normal India update path. They
remain available through the queued backfill repair flow for symbols/dates that
official bhavcopy does not cover.

Useful manual commands:

```bash
npm run sync:nse-history
npm run sync:fundamentals
npm run sync:us
npm run sync:us-history
npm run sync:us-quotes
npm run sync:us-fundamentals
npm run backfill
```

## OHLCV Backfill Queue

Large quote-without-history gaps are repaired through `public.backfill_queue` instead of one huge blast run. The queue is populated idempotently from live coverage gaps: assets with `latest_quotes` but zero `daily_ohlcv` bars.

Priority order:

1. India screener universe: `NIFTY_500`.
2. US screener universe: `SP_500` and `NASDAQ_100` when seeded.
3. User portfolio/watchlist holdings.
4. Active swing signals or open forward-test positions.
5. Remaining India quoted assets.
6. Remaining US quoted assets.

Manual trigger options:

- Browser: open `/data/health`, then use **Populate Queue**, **Run Backfill Now**, or **Re-queue Failed**.
- CLI: start the app first, then run `npm run backfill`.

The app launcher also checks the queue after market-close windows and triggers one configured batch through `/api/backfill/run?job=cron`.

Environment variables:

```bash
BACKFILL_BATCH_SIZE=100
BACKFILL_DELAY_IN_MS=1500
BACKFILL_DELAY_US_MS=1000
BACKFILL_HISTORY_DAYS=504
BACKFILL_SKIP_DURING_MARKET_HOURS=true
BACKFILL_CRON_DISABLED=0
BACKFILL_INDIA_HOUR_IST=17
BACKFILL_US_HOUR_IST=22
```

Monitor progress in SQL:

```sql
select tier, status, count(*)
from public.backfill_queue
group by tier, status
order by tier, status;
```

The worker only inserts/upserts OHLCV bars through the existing history scripts. It does not delete data. Rows that already gained history are marked `skipped`; failed rows retry up to three attempts before becoming `failed`.

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```bash
DATABASE_URL=postgresql://abrarahmedkhan@127.0.0.1:5432/investogenie
SESSION_SECRET=replace-with-a-long-random-secret
CRON_SECRET=replace-with-a-long-random-secret

# Optional — powers the natural-language screener box on /terminal/{us,in}/stocks.
# Without it the rest of the screener works normally and the NL box reports that
# it is unconfigured. Get a key at https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-...
```

Start the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Local Database Access

Use these settings in TablePlus, DBeaver, pgAdmin, or another Postgres client:

```text
Host: 127.0.0.1
Port: 5432
Database: investogenie
User: abrarahmedkhan
Password: blank
SSL: disabled/default
```

Connection URL:

```text
postgresql://abrarahmedkhan@127.0.0.1:5432/investogenie
```

## Verification

Common checks:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run smoke      # requires the app running on http://127.0.0.1:3000
```

The build uses local fonts, so it does not depend on fetching Google Fonts from the sandbox.

## Known Gaps

- US quote and fundamentals coverage is much broader than US historical OHLCV scan coverage. The new `sync:us-history` Yahoo pipeline expands this coverage in conservative batches.
- Provider APIs can rate-limit or block scripted traffic; the sync-state tables keep recurring jobs moving past unsupported symbols.
- A visible admin/data freshness page would make sync health easier to inspect from the browser.
