# InvestoGenie - Capabilities

> Current capability snapshot (2026-07-26) after the NSE/BSE weekend-staleness fix, the email
> digest, encrypted credentials, multi-provider NL query, US OHLCV backfill, permanent OTC
> exclusion, the incremental US history sync fix, and Help knowledge-base work.
> Current codebase: local PostgreSQL, Next.js 16, Yahoo/Google/NSE/FRED-backed sync (Tiingo is
> configured via `FINANCIAL_API_KEY` but not wired into the active recurring sync path).

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
| Provider fallback | Yahoo Finance (US OHLCV history, free/unofficial), Google Finance fallback for quotes. A Tiingo-based module (`lib/ingest/usHistory.ts`) exists and is configured but is NOT used by the recurring sync path — see Architecture. | Working |

## Current Local Data Coverage

Measured from the local `investogenie` PostgreSQL database on 2026-07-25:

| Dataset | Count |
| --- | ---: |
| Assets (all markets/classes) | 16,622 (post OTC exclusion, down from 18,286) |
| Daily OHLCV bars | 7,664,899 |
| Latest quotes | 16,127 |
| Swing signals | 10,809 |
| Financial reports | 126,390 |
| Macro indicators | 8,195 |
| Cron logs | 421 |

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
| US | 8,991 | 8,543 | 95.0% |
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
| US | 5,449 |

(Counted via `latest_financials`, one row per asset's most recent report. Corrects the
2026-07-24 snapshot's figures of 6,965/6,227, which used a different, inconsistent count.)

Swing scan coverage:

| Market | Scanned | Buy candidates (verdict ≠ NO_SETUP) |
| --- | ---: | ---: |
| India | 2,946 | 450 |
| US | 7,863 | 1,071 |

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

NSE/BSE freshness is trading-calendar-aware, not a flat clock (fixed 2026-07-26): Friday's
close reads as fresh through the whole weekend and Monday morning, degrades to stale only once
Monday's own session closes with nothing posted yet, and only reaches failed after a genuinely
stuck multi-day gap — both for the per-symbol "History stale" gap and the "NSE/BSE OHLCV
History" source cards. (US markets are also closed weekends; the same fix was not extended
there — see Remaining Gaps.)

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
| Data providers | Yahoo Finance (US OHLCV history, active), Google Finance, NSE bhavcopy, FRED. Tiingo (`lib/ingest/usHistory.ts`) is configured but currently unused by the recurring sync. |
| Scheduler | Node wrapper (`scripts/run-with-nse-sync.mjs`) around Next.js plus Python child jobs |

## Verification Status

NSE/BSE weekend-staleness fix, 2026-07-26:

```bash
npx tsc --noEmit                              # clean
npm test                                      # 81/81 passing (+5 new)
npm run build                                 # clean
npx eslint lib/dataHealth.ts lib/dataHealth.test.ts   # clean
```

Cross-checked against the live database at three real timestamps (Sunday, Monday 10:00 IST,
Monday 19:00 IST) using the actual current Friday OHLCV bar date — confirmed fresh / fresh /
stale, matching the fix's intent, not the previous stale / failed / failed.

Full-repo check run on 2026-07-25:

```bash
npx tsc --noEmit    # clean
npm test            # 76/76 passing
npm run build       # clean, all static pages generated including 7 /help/[slug] articles
npx eslint .         # 6 errors + 1 warning — see note below
```

The `eslint .` run (whole repo, not just changed files) surfaced 6 pre-existing issues unrelated
to recent work: 4 `no-explicit-any` errors (`backfill-us`, `scan`, `syncJobWrapper`,
`syncMonitor` routes), 1 unused-import warning (`refresh-quotes`), and 2 `<a>`-vs-`<Link>`
errors in `components/landing/LandingPage.tsx` that a file-scoped lint had never caught before.
None are new regressions; none fixed here.

The email digest, AI-credential round-trip, swing/probability data-source fixes, US history sync
selection/throughput fix, and OTC exclusion were additionally verified against the live local
database (not just static analysis) — see `STATUS.md` for the specific queries and results.

## Remaining Gaps

- The weekend-staleness fix (2026-07-26) covers NSE/BSE only. US markets are also closed
  Sat/Sun, so "US OHLCV History" / "US Quotes" source cards have the identical flat-cadence
  flaw and would likewise show false stale/failed statuses over the US weekend — not fixed here,
  since it needs an equivalent "expected trading day + after-close" helper for US market hours
  (ET-based) that doesn't exist yet, and the request that prompted this fix was specifically
  about NSE/BSE.
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
  actual user mutual-fund holdings; current match coverage is 1/21 imported funds (down from
  6/21 in an earlier snapshot — worth checking whether a mapping was unlinked or the count
  methodology changed).
- The email digest scheduler only runs while the app process is running; guaranteed delivery
  regardless of host uptime needs an always-on deployment or an external/Vercel cron backstop.
- Help articles are static (compiled into the content registry) — updating copy requires a code
  change, not a CMS edit; no cross-article search yet.
- Provider rate limits and unsupported/delisted symbols are expected; sync-state tables track
  attempts and keep recurring jobs rotating through the universe.
- The incremental US history sync backlog is clearing but slower than the original "~a day"
  estimate: active-swing-signal-on-stale-history rows went from 440 (2026-07-24) to 371
  (2026-07-25) — real progress, not fully resolved. Most likely cause is intermittent app
  uptime (the dev server was restarted several times for other testing) rather than a flaw in
  the fix; needs another observation window under continuous uptime to confirm.
- Minor pre-existing data-quality nit: ticker `ALUR` (US) has two separate `assets` rows (`OTC`
  and `OTHER` exchange) — harmless duplicate-fetch, not a functional bug, not yet cleaned up.
- `ARCHITECTURE.md` should be refreshed in a later pass; `CAPABILITIES.md`, `STATUS.md`, and
  `README.md` are the most current product summaries.
