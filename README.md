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
| Daily OHLCV bars | 4,302,369 |
| Latest quotes | 17,242 |
| Swing signals | 2,418 |
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

- refreshes security listings,
- refreshes latest market quotes,
- syncs US quotes from Yahoo Finance,
- falls back to Google Finance for unresolved US quotes,
- runs the swing scan,
- starts NSE incremental OHLCV sync,
- starts Indian fundamentals sync,
- starts US fundamentals sync,
- repeats market quote refresh on `MARKET_REFRESH_INTERVAL_MINUTES`,
- schedules the daily NSE history sync by IST time.

Useful manual commands:

```bash
npm run sync:nse-history
npm run sync:fundamentals
npm run sync:us
npm run sync:us-quotes
npm run sync:us-fundamentals
```

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
```

The build uses local fonts, so it does not depend on fetching Google Fonts from the sandbox.

## Known Gaps

- US quote and fundamentals coverage is much broader than US historical OHLCV scan coverage. Expanding US OHLCV backfill is the main remaining data-depth task.
- Provider APIs can rate-limit or block scripted traffic; the sync-state tables keep recurring jobs moving past unsupported symbols.
- A visible admin/data freshness page would make sync health easier to inspect from the browser.
