# InvestoGenie - Capabilities

> Current capability snapshot after the local Postgres migration, US/India data sync expansion, data health dashboard, and macro lead/lag activation.
> Current codebase: local PostgreSQL, Next.js 16, Yahoo/Google/NSE/FRED-backed sync.

## In One Line

InvestoGenie is a local-first US and India market terminal with portfolio tracking, live quote refreshes, OHLCV history, buy-candidate swing screening, company fundamentals, macro lead/lag analytics, market dashboards, and recurring data sync jobs.

## Capabilities At A Glance

| Area | What it does | Status |
| --- | --- | --- |
| Local Postgres backend | Users, assets, quotes, OHLCV, signals, reports, macro, portfolio data | Working |
| Landing experience | WebGL hero, market pivot, ticker tape, animated content | Working |
| Market overviews | Separate US and India dashboards with quotes, breadth, charts, candidates | Working |
| Auth | Local email/password with signed HTTP-only session cookie | Working |
| Portfolio terminal | Holdings, watchlist, trade ledger, benchmark cards | Working |
| Swing candidates | Buy-candidate screener with entry, target, stop, trail, score, days | Working |
| Stock Screener | `/screener` — US+India fundamental/price-action screener: filter engine, presets, saved screens, universes, CSV/Excel export, dashboard widget | Working |
| Legendary strategies | Qullamaggie, Minervini, Darvas, PTJ, Simons tags and filters | Working |
| Fundamentals | P/E, market cap, ROCE, YoY profit/sales growth in screener | Working |
| Macro lead/lag | FRED-backed cross-asset rolling correlation and lead/lag matrix | Working |
| Sync health | Browser-visible `/admin/sync` freshness and provider status page | Working |
| Recurring sync | Startup, recurring, and daily jobs for quotes, OHLCV, fundamentals, macro, scans | Working |
| Provider fallback | Yahoo Finance primary, Google Finance fallback for quotes | Working |

## Current Local Data Coverage

Measured from the local `investogenie` PostgreSQL database:

| Dataset | Count |
| --- | ---: |
| Assets | 18,070 |
| Daily OHLCV bars | 4,331,081 |
| Latest quotes | 17,244 |
| Swing signals | 2,465 |
| Financial reports | 83,494 |
| Macro indicators | 8,131 |
| Cron logs | 95 |

Asset universe:

| Market | Exchange | Class | Count |
| --- | --- | --- | ---: |
| India | BSE | Derivative | 1 |
| India | BSE | Stock | 5,088 |
| India | FX | Currency | 1 |
| India | NSE | Derivative | 2 |
| India | NSE | Stock | 2,407 |
| US | CBOE | Stock | 30 |
| US | NASDAQ | Stock | 4,387 |
| US | NYSE | Bond | 1 |
| US | NYSE | Stock | 3,332 |
| US | OTC | Stock | 2,608 |
| US | OTHER | Stock | 213 |

Fundamentals coverage:

| Market | Assets with reports |
| --- | ---: |
| India | 6,926 |
| US | 1,522 |

Swing scan coverage:

| Market | Scanned | Buy candidates |
| --- | ---: | ---: |
| India | 2,388 | 202 |
| US | 77 | 7 |

Macro coverage:

| Indicator | Rows | Date range |
| --- | ---: | --- |
| BRENT_CRUDE | 1,264 | 2021-07-07 to 2026-07-06 |
| FED_FUNDS | 1,829 | 2021-07-07 to 2026-07-09 |
| US_10Y_YIELD | 1,252 | 2021-07-07 to 2026-07-09 |
| US_DOLLAR_BROAD | 1,248 | 2021-07-07 to 2026-07-02 |
| USD_INR | 1,249 | 2021-07-07 to 2026-07-02 |
| VIX | 1,289 | 2021-07-07 to 2026-07-09 |

## User Experience

### Landing Page

- Full-screen dark financial terminal style.
- Three.js/WebGL hero canvas.
- Animated headline and scroll sections.
- US/India market pivot.
- Live ticker tape from the local quote table.
- Entry points into market overview, terminal, and swing candidates.

### Market Overview

Dedicated pages:

- `/markets/us`
- `/markets/in`

Each page presents a compact market terminal dashboard with quote panels, normalized performance charts, breadth, candidate rows, and fundamentals leaders.

### Portfolio Terminals

Authenticated terminals:

- `/terminal/us`
- `/terminal/in`

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

Routes:

- `/terminal/us/screener`
- `/terminal/in/screener`

Rows include current price, entry, target, stop loss, trailing stop, score, expected days, strategy tags, and fundamentals.

Filters include:

- ticker search,
- setups/buy-candidates toggle,
- strategy ribbon,
- ROCE minimum,
- P/E maximum.

### Data Health

Route:

- `/admin/sync`

The page shows:

- per-market asset, quote, history, and fundamentals counts,
- latest quote, OHLCV, and financial-report dates,
- quote provider coverage,
- fundamentals provider coverage,
- recent cron/sync job history.

## Analytics

### Swing Classifier

The classifier uses:

- Donchian breakout/breakdown structure,
- Bollinger bandwidth squeeze,
- ATR-based trade levels,
- volume expansion,
- open-interest buildup where available,
- read-time risk derivation.

Buy entries are rebased to the latest available market price once a trigger has already traded, avoiding stale entries below the current quote.

### Legendary Strategy Tags

| Strategy | Core idea |
| --- | --- |
| Qullamaggie | High tight flag and compression after thrust |
| Minervini | Trend Template and volatility contraction pivot |
| Darvas | Confirmed box breakout |
| Paul Tudor Jones | 200-day moving-average trend rule |
| Simons | Statistical mean reversion at z-score extremes |

### Fund Intelligence

- India mutual fund overlap engine is wired into the terminal.
- It reads the signed-in user's actual mutual fund holdings.
- It compares fund look-through holdings against `mutual_fund_holdings`.
- It can flag overlap concentration and DIRECT-plan optimization suggestions when holding data exists.

### Macro Lead/Lag

The macro engine now has real historical data and recurring sync.

Data source:

- FRED public CSV downloads through `pipelines/macro_sync.py`.

Synced indicators:

- US 10Y yield,
- Fed Funds,
- USD/INR,
- Brent crude,
- VIX,
- US broad dollar index.

Market proxy baskets:

- US: SPY, QQQ, NVDA.
- India: RELIANCE, HDFCBANK, INFY, TCS.

The engine computes:

- rolling 30-day and 90-day return correlations,
- best lead/lag over the configured lag window,
- lead days,
- accumulation, distribution, coincident, and weak signals.

## Fundamentals

Fundamentals are stored in `asset_financial_reports` and surfaced through latest-financials joins.

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

Normal launcher:

```bash
npm run dev
```

That command starts Next.js through `scripts/run-with-nse-sync.mjs` and also starts the local sync loop.

The sync loop does:

- security listings refresh,
- market quote refresh,
- US Yahoo Finance quote sync,
- US Google Finance fallback quote sync,
- US OHLCV history expansion,
- FRED macro history sync,
- swing signal scan,
- NSE incremental OHLCV sync,
- India fundamentals sync,
- US fundamentals sync,
- recurring quote/macro/scan refresh while the server stays open,
- daily NSE sync at the configured IST time.

Manual sync commands:

```bash
npm run sync:nse-history
npm run sync:fundamentals
npm run sync:us
npm run sync:us-history
npm run sync:us-quotes
npm run sync:us-fundamentals
npm run sync:macro
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
| Data providers | Yahoo Finance, Google Finance, NSE/Yahoo Finance, FRED |
| Scheduler | Node wrapper around Next.js plus Python child jobs |

## Verification Status

Latest checks run after macro lead/lag activation:

```bash
npm run sync:macro -- --years 5
npm run lint
npx tsc --noEmit
npm run build
npm run smoke
```

All passed.

## Remaining Gaps

- US historical OHLCV scan coverage is still smaller than US listings, quotes, and fundamentals coverage. `sync:us-history` expands it in recurring Yahoo-backed batches.
- Open-interest validation is wired in the classifier, but local OHLCV currently has no populated open-interest data, so OI-specific confirmation is not active yet.
- Fund overlap is implemented, but it depends on populated `mutual_fund_holdings` look-through data and actual user mutual-fund holdings.
- Provider rate limits and unsupported symbols are expected; sync-state tables track attempts and keep recurring jobs rotating through the universe.
- `ARCHITECTURE.md` should be refreshed in a later pass; this capabilities document and README are the most current product summaries.
