# InvestoGenie - Capabilities

> Review-oriented snapshot of what has been achieved so far.
> Current codebase: local PostgreSQL, Next.js 16, Yahoo/Google/NSE sync.

## In One Line

InvestoGenie is a local-first US and India market terminal with portfolio tracking, live quote refreshes, buy-candidate swing screening, company fundamentals, market dashboards, and recurring data sync jobs.

## Capabilities At A Glance

| Area | What it does | Status |
| --- | --- | --- |
| Local Postgres backend | Users, assets, quotes, OHLCV, signals, reports, portfolio data | Working |
| Landing experience | WebGL hero, market pivot, ticker tape, animated content | Working |
| Market overviews | Separate US and India dashboards with quotes, breadth, charts, candidates | Working |
| Auth | Local email/password with signed HTTP-only session cookie | Working |
| Portfolio terminal | Holdings, watchlist, trade ledger, benchmark cards | Working |
| Swing candidates | Buy-candidate screener with entry, target, stop, trail, score, days | Working |
| Legendary strategies | Qullamaggie, Minervini, Darvas, PTJ, Simons tags and filters | Working |
| Fundamentals | P/E, market cap, ROCE, YoY profit/sales growth in screener | Working |
| Recurring sync | Startup, recurring, and daily jobs for quotes, OHLCV, fundamentals, scans | Working |
| Provider fallback | Yahoo Finance primary, Google Finance fallback for quotes | Working |

## Current Local Data Coverage

Measured from the local `investogenie` PostgreSQL database:

| Dataset | Count |
| --- | ---: |
| Assets | 18,070 |
| Daily OHLCV bars | 4,304,693 |
| Latest quotes | 17,242 |
| Swing signals | 2,422 |
| Financial reports | 83,443 |
| Cron logs | 91 |

Asset universe:

| Market | Exchange | Class | Count |
| --- | --- | --- | ---: |
| India | NSE | Stock | 2,407 |
| India | BSE | Stock | 5,088 |
| India | FX | Currency | 1 |
| US | NASDAQ | Stock | 4,387 |
| US | NYSE | Stock | 3,332 |
| US | OTC | Stock | 2,608 |
| US | CBOE | Stock | 30 |
| US | OTHER | Stock | 213 |

Fundamentals coverage:

| Market | Assets with reports |
| --- | ---: |
| India | 6,917 |
| US | 1,522 |

Swing scan coverage:

| Market | Scanned | Buy candidates |
| --- | ---: | ---: |
| India | 2,387 | 238 |
| US | 34 | 6 |

## User Experience

### Landing Page

- Full-screen dark financial terminal style.
- Three.js/WebGL hero canvas.
- Animated headline and scroll sections.
- US/India market pivot.
- Live ticker tape from the local quote table.
- Entry points into market overview, terminal, and swing candidates.

### Market Overview

The app now has dedicated pages for:

- `/markets/us`
- `/markets/in`

Each page presents a compact market terminal dashboard with quote panels, normalized performance charts, breadth, candidate rows, and fundamentals leaders. The visual treatment is denser and more terminal-like than the landing page.

### Portfolio Terminals

The authenticated terminals are:

- `/terminal/us`
- `/terminal/in`

Each terminal is market-scoped. Holdings, watchlist, quotes, benchmarks, and currency formatting follow the selected market.

Implemented terminal functions:

- default user portfolio and watchlist scaffold,
- holdings table,
- current quote and day-change display,
- trade ticket,
- transaction ledger writes,
- watchlist add/remove,
- benchmark cards,
- analytical engine section.

### Swing Candidates

The screener language has been shifted from long/short trading to clearer buy-candidate language.

Routes:

- `/terminal/us/screener`
- `/terminal/in/screener`

The India screener currently shows the top 20 NSE buy candidates. Rows include current price, entry, target, stop loss, trailing stop, score, expected days, strategy tags, and fundamentals.

Filters include:

- ticker search,
- setups/buy-candidates toggle,
- strategy ribbon,
- ROCE minimum,
- P/E maximum.

## Analytics

### Swing Classifier

The classifier uses:

- Donchian breakout/breakdown structure,
- Bollinger bandwidth squeeze,
- ATR-based trade levels,
- volume expansion,
- open-interest buildup where available,
- read-time risk derivation.

Long entries are rebased to the latest available market price once a trigger has already traded, avoiding stale buy entries below the current quote.

### Legendary Strategy Tags

The screener supports five strategy families:

| Strategy | Core idea |
| --- | --- |
| Qullamaggie | High tight flag and compression after thrust |
| Minervini | Trend Template and volatility contraction pivot |
| Darvas | Confirmed box breakout |
| Paul Tudor Jones | 200-day moving-average trend rule |
| Simons | Statistical mean reversion at z-score extremes |

### Fundamentals

Fundamentals are stored in `asset_financial_reports` and surfaced through a latest-financials view.

Metrics include:

- revenue,
- net profit,
- operating profit,
- EBIT,
- capital employed,
- EPS,
- CMP,
- P/E,
- market cap,
- ROCE,
- YoY profit variance,
- YoY sales variance.

India values are stored in Rs. crore. US values are stored in USD millions.

## Data Sync

The normal launcher is:

```bash
npm run dev
```

That command starts Next.js through `scripts/run-with-nse-sync.mjs` and also starts the local sync loop.

The sync loop does:

- security listings refresh,
- market quote refresh,
- US Yahoo Finance quote sync,
- US Google Finance fallback quote sync,
- swing signal scan,
- NSE incremental OHLCV sync,
- India fundamentals sync,
- US fundamentals sync,
- recurring quote refresh while the server stays open,
- daily NSE sync at the configured IST time.

Manual sync commands:

```bash
npm run sync:nse-history
npm run sync:fundamentals
npm run sync:us
npm run sync:us-history
npm run sync:us-quotes
npm run sync:us-fundamentals
```

## Architecture

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 App Router |
| UI | React 19, Tailwind CSS |
| Effects | Three.js, React Three Fiber, GSAP |
| Database | Local PostgreSQL |
| DB access | `pg` for app code, `psycopg2` for Python pipelines |
| Auth | Local users table + signed HTTP-only cookies |
| Data providers | Yahoo Finance, Google Finance, NSE/Yahoo Finance |
| Scheduler | Node wrapper around Next.js plus Python child jobs |

## Remaining Gaps

- US historical OHLCV scan coverage is still much smaller than US listings, quotes, and fundamentals coverage, but `sync:us-history` now expands it in recurring Yahoo-backed batches.
- A browser-visible sync health/admin page should be added for `cron_logs`, `quote_sync_state`, and `fundamentals_sync_state`.
- Provider rate limits and unsupported symbols are expected; sync-state tables track attempts and keep recurring jobs rotating through the universe.
- `ARCHITECTURE.md` should also be refreshed in a later pass; this capabilities document and README are now the most current product summary.
