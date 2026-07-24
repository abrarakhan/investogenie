# InvestoGenie - Capabilities

> Current capability snapshot after the email digest, encrypted credentials, multi-provider
> NL query, US OHLCV backfill, and Help knowledge-base work.
> Current codebase: local PostgreSQL, Next.js 16, Tiingo/Yahoo/Google/NSE/FRED-backed sync.

## In One Line

InvestoGenie is a local-first US and India market terminal with portfolio tracking, live quote
refreshes, OHLCV history, legendary-strategy swing screening, a probability forecast engine,
company fundamentals, macro lead/lag analytics, a daily email digest, encrypted per-user
credentials, a multi-provider natural-language screener, a professional help/knowledge base,
and recurring data sync jobs.

## Capabilities At A Glance

| Area | What it does | Status |
| --- | --- | --- |
| Local Postgres backend | Users, assets, quotes, OHLCV, signals, reports, macro, portfolio, credentials data | Working |
| Landing experience | WebGL hero, market pivot, ticker tape, animated content | Working |
| Market overviews | Separate US and India dashboards with quotes, breadth, charts, candidates | Working |
| Auth | Local email/password with signed HTTP-only session cookie | Working |
| Portfolio terminal | Holdings, watchlist, trade ledger, benchmark cards | Working |
| Swing candidates | Buy-candidate screener with entry, target, stop, trail, score, days | Working |
| Stock Screener | US+India fundamental/price-action screener: filter engine, presets, saved screens, universes, CSV/Excel export | Working |
| **NL Query (screener)** | Plain-English → filters, dispatched to a **user-chosen AI provider** (Anthropic/OpenAI/Google), validated through the same filter-engine guard regardless of provider | Working |
| Legendary strategies | Qullamaggie, Minervini, Darvas, PTJ, Simons tags and filters | Working |
| Probability engine | 21-trading-day return distribution per stock: expected return, P(up), drawdown risk, Student-t price range | Working |
| Fundamentals | P/E, market cap, ROCE, YoY profit/sales growth in screener | Working |
| Macro lead/lag | FRED-backed cross-asset rolling correlation and lead/lag matrix | Working |
| **Email digest** | Daily 07:00 IST email with top Swing Candidates + Probability forecasts, same engines as the screens | Working |
| **Encrypted credentials** | AES-256-GCM storage for SMTP password and the active AI provider/model/key, editable in Settings | Working |
| **Help & knowledge base** | `/help` guided walkthrough + 7 code-accurate articles (engine + 5 strategies + probability method) | Working |
| Sync health | Browser-visible `/admin/sync` and `/data/health` freshness and provider status pages | Working |
| Recurring sync | Startup, recurring, and daily jobs for quotes, OHLCV, fundamentals, macro, scans, and the email digest | Working |
| Provider fallback | Tiingo (US history) / Yahoo Finance primary, Google Finance fallback for quotes | Working |

## Current Local Data Coverage

Measured from the local `investogenie` PostgreSQL database on 2026-07-24:

| Dataset | Count |
| --- | ---: |
| Assets (all markets/classes) | 16,622 (post OTC exclusion, down from 18,286) |
| Daily OHLCV bars | 7,644,812 |
| Latest quotes | 16,125 (down from 17,432 after the OTC quote purge) |
| Swing signals | 10,782 |
| Financial reports | 123,450 |
| Macro indicators | 8,192 |
| Cron logs | 401 |

Asset universe:

| Market | Exchange | Class | Count |
| --- | --- | --- | ---: |
| India | BSE | Stock | 5,110 |
| India | BSE | Derivative | 1 |
| India | CAS_MF | Mutual fund (user-imported) | 63 |
| India | CAS_STOCK | Stock (user-imported) | 37 |
| India | FX | Currency | 1 |
| India | NSE | Stock | 2,416 |
| India | NSE | Derivative | 2 |
| US | CBOE | Stock | 30 |
| US | NASDAQ | Stock | 4,419 |
| US | NYSE | Stock | 3,340 |
| US | NYSE | Bond | 1 |
| US | OTC | Stock | 946 |
| US | OTHER | Stock | 256 |

US/India OHLCV coverage:

| Market | Active stocks | With OHLCV history | Coverage |
| --- | ---: | ---: | ---: |
| US | 8,991 | 8,505 | 94.6% |
| India | 7,563 | 7,284 | 96.3% |

> **Note on US OTC:** `scripts/ingest-listings.mjs` permanently excludes OTC from the US listings
> it ingests (`EXCLUDED_US_EXCHANGES`), fixing an earlier bug where a manual OTC purge was
> silently reverted by the next listing-sync run. 1,664 no-history OTC assets were removed on
> 2026-07-24 and verified to stay removed across repeated listing-sync runs; the 946 OTC assets
> that already had real OHLCV history were left untouched. See `STATUS.md` → US History Coverage
> → OTC exclusion for the full account.

Fundamentals coverage:

| Market | Assets with a latest financial report |
| --- | ---: |
| India | 6,507 |
| US | 5,158 |

Swing scan coverage:

| Market | Scanned | Buy candidates (verdict ≠ NO_SETUP) |
| --- | ---: | ---: |
| India | 2,946 | 450 |
| US | 7,819 | 1,030 |

Macro coverage:

| Indicator | Rows | Date range |
| --- | ---: | --- |
| BRENT_CRUDE | 1,274 | 2021-07-07 to 2026-07-20 |
| FED_FUNDS | 1,842 | 2021-07-07 to 2026-07-22 |
| US_10Y_YIELD | 1,261 | 2021-07-07 to 2026-07-22 |
| US_DOLLAR_BROAD | 1,258 | 2021-07-07 to 2026-07-17 |
| USD_INR | 1,259 | 2021-07-07 to 2026-07-17 |
| VIX | 1,299 | 2021-07-07 to 2026-07-23 |

## User Experience

### Landing Page

- Full-screen dark financial terminal style.
- Three.js/WebGL hero canvas.
- Animated headline and scroll sections.
- US/India market pivot.
- Live ticker tape from the local quote table.
- Entry points into market overview, terminal, swing candidates, and Help.

### Market Overview

Dedicated pages:

- `/markets/us`
- `/markets/in`

Each page presents a compact market terminal dashboard with quote panels, normalized performance
charts, breadth, candidate rows, and fundamentals leaders.

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

### Swing Candidates / Screener

Routes:

- `/terminal/us/screener`
- `/terminal/in/screener`

Rows include current price, entry, target, stop loss, trailing stop, score, expected days,
strategy tags, and fundamentals.

Filters include:

- ticker search,
- setups/buy-candidates toggle,
- strategy ribbon (Qullamaggie / Minervini / Darvas / PTJ / Simons),
- ROCE minimum, P/E maximum, and the full field-registry filter engine,
- **natural-language query bar** — types a plain-English request, dispatches it to the
  user's chosen AI provider, and renders the returned filters as removable chips.

### Probability

Route:

- `/terminal/[market]/probability`

Shows, per eligible stock (≥ 280 bars of history): expected 21-day return, probability of an
up move, annualised/21-day volatility, drawdown risk, and a Student-t percentile price range
(p5/p25/p50/p75/p95). Explicitly flagged as an exploratory, uncalibrated estimate — research
context, not a trading signal.

### Email Digest

Route:

- `/api/cron/send-email-digest` (triggered by the in-app scheduler; also callable manually)

Settings → Email digest lets a user opt in, set a send time, and choose which sections
(Swing Candidates / Probability) to include. The digest:

- pulls the top 5 rows from `runScreener()` (the same function behind the Swing Candidates
  screen) and the top 5 from `getProbabilitySummary()` (the same function behind Probability),
- renders a mobile-responsive HTML card layout with entry/target/stop/R:R for swing rows and
  P(up)/expected-return/drawdown/median-target for probability rows,
- sends via the user's own SMTP credentials (decrypted from `user_credentials`),
- logs every attempt to `cron_logs` (job `send-email-digest`),
- retries same-day on failure (bounded attempts, backoff) and performs a DB-seeded catch-up
  send on startup if the scheduled window was missed while the app wasn't running.

### Secured Credentials

Route:

- Settings → Secured credentials

Stores, per user, AES-256-GCM encrypted:

- SMTP host/port/username/password (used by the email digest),
- the active AI provider (Anthropic / OpenAI / Google), a preset-or-custom model ID, and its
  API key (used by the NL screener query).

The master encryption key lives only in the `CREDENTIAL_ENCRYPTION_KEY` environment variable —
never in the database.

### Help & Knowledge Base

Routes:

- `/help` — guided, numbered walkthrough of the whole app plus a categorized article index
- `/help/[slug]` — 7 statically generated articles

Articles: the shared swing engine (classifier + ATR level derivation), one per legendary
strategy (Qullamaggie, Minervini, Darvas, PTJ, Simons) with named-trader attribution and
literature references, and the probability method. Every formula and threshold quoted was
pulled directly from the implementing source file, not written from general knowledge.

### Data Health

Routes:

- `/admin/sync`
- `/data/health`

The pages show:

- per-market asset, quote, history, and fundamentals counts,
- latest quote, OHLCV, and financial-report dates,
- quote/fundamentals provider coverage,
- coverage-gap detection (quote-without-history, stale fundamentals, stale swing/forward-test
  inputs),
- recent cron/sync job history with expandable error detail.

## Analytics

### Swing Classifier

The classifier uses:

- Donchian breakout/breakdown structure,
- Bollinger bandwidth squeeze (20-bar SMA ± 2σ; squeeze = lowest-quartile bandwidth),
- ATR(14)-based trade levels (entry / stop = 1.5×ATR / target = 2R / chandelier trail = 3×ATR),
- volume expansion vs a 20-bar average,
- open-interest buildup where available,
- read-time risk derivation, so changing risk settings re-derives every row instantly.

Buy entries are rebased to the latest available market price once a trigger has already traded,
avoiding stale entries below the current quote. Full formulas: `/help/swing-engine`.

### Legendary Strategy Tags

| Strategy | Core idea | Reference |
| --- | --- | --- |
| Qullamaggie | High tight flag — ≥3× volume thrust, 3–15 day tight flag, ATR at a 30-day low | `/help/qullamaggie-momentum` |
| Minervini | 8-point Trend Template + narrowing Volatility Contraction Pattern | `/help/minervini-vcp` |
| Darvas | Confirmed box top/bottom, buy-stop one tick above the top | `/help/darvas-box` |
| Paul Tudor Jones | 200-day moving-average regime filter, entry near the mean | `/help/ptj-200-day-trend` |
| Simons | 20-day rolling z-score mean reversion at ±2.5σ | `/help/simons-quant-reversion` |

### Probability Model

Cross-sectional factor model: 12-1 and 6-1 momentum, 20-day/5-day mean-reversion snapback, and
EWMA(λ=0.94) volatility combine into an expected 21-day return, then a signal-to-noise ratio
drives a sigmoid probability of an up move. The price range uses Student-t(df=5) quantiles,
unit-scaled before applying volatility. Full formulas: `/help/probability-method`.

### Fund Intelligence

- India mutual fund overlap engine is wired into the terminal.
- It reads the signed-in user's actual mutual fund holdings.
- It compares fund look-through holdings against AMC monthly disclosure snapshots via explicit
  `user_fund_mappings`.
- It can flag overlap concentration and DIRECT-plan optimization suggestions when holding data
  exists.

### Macro Lead/Lag

Data source:

- FRED public CSV downloads through `pipelines/macro_sync.py`.

Synced indicators: US 10Y yield, Fed Funds, USD/INR, Brent crude, VIX, US broad dollar index.

Market proxy baskets: US — SPY, QQQ, NVDA. India — RELIANCE, HDFCBANK, INFY, TCS.

The engine computes rolling 30-day and 90-day return correlations, best lead/lag over the
configured lag window, lead days, and accumulation/distribution/coincident/weak signal labels.

## Fundamentals

Fundamentals are stored per-asset and surfaced through latest-financials joins.

Metrics include: revenue, net profit, operating profit, EBIT, capital employed, EPS, CMP, P/E,
market cap, ROCE, ROE, debt-to-equity, dividend yield, free cash flow, YoY profit/sales growth.

India values are stored in Rs. crore. US values are stored in USD millions — the NL query
prompt explicitly handles this unit conversion per market.

## Data Sync

Normal launcher:

```bash
npm run dev
```

That command starts Next.js through `scripts/run-with-nse-sync.mjs`, which also drives the
in-app sync/scheduler loop — no external cron service is required for local/single-host use.

The wrapper's recurring loop does:

- security listings refresh,
- market quote refresh (15-minute India market-hours cadence),
- US quote/fundamental/history sync hooks — US history via free Yahoo Finance (`yfinance`),
  150 symbols/hour, prioritized by staleness (oldest-refreshed-first, not lowest-coverage-first)
  since 2026-07-24, so already-covered symbols keep getting refreshed instead of being
  permanently skipped once they cross the minimum-bars threshold,
- FRED macro history sync,
- swing signal scan trigger,
- NSE/BSE bhavcopy incremental OHLCV sync + daily catch-up,
- queued OHLCV backfill-repair trigger (detached worker),
- **daily email digest send** at a configurable IST time, with same-day retry on failure and
  startup catch-up if the window was missed.

Manual sync / ops commands:

```bash
npm run sync:nse-history
npm run sync:fundamentals
npm run sync:us
npm run sync:us-history
npm run sync:us-quotes
npm run sync:us-fundamentals
npm run sync:macro
node scripts/backfill-progress.mjs   # queue + coverage status for the OHLCV backfill
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
| Credential encryption | AES-256-GCM, scrypt key derivation, master key in `CREDENTIAL_ENCRYPTION_KEY` |
| Email | Nodemailer, per-user SMTP credentials |
| AI providers | Anthropic (native structured output), OpenAI (Chat Completions JSON mode), Google Gemini (`generateContent` JSON) |
| Data providers | Tiingo (US OHLCV history), Yahoo Finance, Google Finance, NSE bhavcopy, FRED |
| Scheduler | Node wrapper (`scripts/run-with-nse-sync.mjs`) around Next.js plus Python child jobs |

## Verification Status

Latest checks (2026-07-24, after the Help knowledge-base work):

```bash
npx tsc --noEmit
npx eslint <changed files>
npm test          # 76/76 passing
npm run build     # generates all static pages, including 7 /help/[slug] articles
```

All passed. The email digest, AI-credential round-trip, and swing/probability data-source fixes
were additionally verified against the live local database and a real end-to-end email send
earlier in the same day.

## Remaining Gaps

- US OTC coverage is intentionally excluded (see the note under Current Local Data Coverage
  above) — if OTC history is ever wanted, it needs a different provider than Tiingo EOD, since
  that is the actual reason OTC has no bars, not a bug in the ingestion job.
- Open-interest validation is wired in the swing classifier, but local OHLCV currently has no
  populated open-interest data, so OI-specific confirmation is not active; cash-equity swing
  scores are capped at 0.70 as a result (documented in `/help/swing-engine`).
- The Probability model's factor weights are hand-tuned, not fit to realised outcomes — every
  forecast row is flagged "calibration pending" (documented in `/help/probability-method`).
- NL query dispatch to OpenAI and Google has not yet been exercised end-to-end with real API
  keys; only the Anthropic path has a verified live send.
- Fund overlap is implemented, but depends on populated AMC snapshot look-through data and
  actual user mutual-fund holdings; current match coverage is 6/21 imported funds.
- The email digest scheduler only runs while the app process is running; guaranteed delivery
  regardless of host uptime needs an always-on deployment or an external/Vercel cron backstop.
- Help articles are static (compiled into the content registry) — updating copy requires a code
  change, not a CMS edit; no cross-article search yet.
- Provider rate limits and unsupported/delisted symbols are expected; sync-state tables track
  attempts and keep recurring jobs rotating through the universe.
- The incremental US history sync backlog (~4,500 symbols >3 days stale as of 2026-07-24) clears
  over roughly a day at the new 150/hour throughput, not instantly — Data Health's "Swing signal
  on stale data" count will still show elevated numbers for a short window after this fix ships.
- Minor pre-existing data-quality nit: ticker `ALUR` (US) has two separate `assets` rows (`OTC`
  and `OTHER` exchange) — harmless duplicate-fetch, not a functional bug, not yet cleaned up.
- `ARCHITECTURE.md` should be refreshed in a later pass; `CAPABILITIES.md`, `STATUS.md`, and
  `README.md` are the most current product summaries.
