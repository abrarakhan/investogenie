# InvestoGenie Status

_Last updated: 2026-07-22_

This file summarizes what has been built so far, what is currently working, what is partial, and what to build next.

## Product Direction

InvestoGenie is now a local-first market terminal and portfolio intelligence app for Indian and US markets. The current build focuses on:

- Market overview and charting for India and US.
- Buy candidate discovery for swing trading.
- Rule-based and probability-style strategy screens.
- Local Postgres as the system of record.
- Recurring quote/history/fundamental/macro sync jobs.
- Portfolio import and Fund Overlap X-Ray using CAS and AMC disclosures.
- Forward-testing infrastructure to judge strategies out of sample.
- Data coverage visibility and repair workflows for fund mappings, source freshness, and stale strategy inputs.

## Current App Surfaces

### Public / Orientation

- Landing page: `/`
- Help page: `/help`
- About page: `/about`
- Login: `/login`

### Terminal Workspaces

- India terminal: `/terminal/in`
- US terminal: `/terminal/us`
- New market workspace route family: `/app/[market]`
- Market overview route: `/markets/[market]`
- Stocks route: `/terminal/[market]/stocks`
- Screener route: `/terminal/[market]/screener`
- Probability route: `/terminal/[market]/probability`
- Forward-test route: `/terminal/[market]/forward-test`
- Import holdings / CAS route: `/terminal/in/cas`

### Portfolio / Data / Admin

- Portfolio pages: `/portfolio`, `/portfolio/import`, `/portfolio/fund-mapping`, `/portfolio/fund-xray`
- Data pages: `/data`, `/data/sync`, `/data/health`
- Admin sync page: `/admin/sync`
- Settings: `/settings`

## Backend And Database

The app has been fully moved away from Supabase client usage and now uses direct local Postgres through `lib/db.ts`.

Current database migration stack:

- `0001_init.sql`: local users, portfolios, holdings, trades base.
- `0002_multi_asset.sql`: canonical multi-asset catalog, derivatives, mutual fund holdings.
- `0003_unify_assets.sql`: unifies old stock references onto `assets`.
- `0004_latest_quotes.sql`: latest quote table.
- `0005_swing_signals.sql`: swing signal storage.
- `0006_swing_levels.sql`: entry/target/stop/trailing-stop levels.
- `0007_risk_settings_and_short.sql`: per-user risk settings and short support.
- `0008_strategy_tags.sql`: strategy tags.
- `0009_cron_logs.sql`: cron/job logging.
- `0010_financial_reports.sql`: corporate financial report storage.
- `0011_fundamentals_sync_state.sql`: fundamentals sync state.
- `0012_stock_screener.sql`: screener fields and snapshots.
- `0013_user_mutual_fund_holdings.sql`: user-specific fund look-through imports.
- `0014_forward_test.sql`: forward-test positions.
- `0015_forward_test_fill.sql`: trigger/fill tracking for forward tests.
- `0016_fund_snapshots.sql`: monthly AMC fund holdings snapshots.
- `0017_fund_mapping.sql`: explicit per-user CAS fund holding to AMC snapshot scheme mappings.

## Current Local Data Coverage

Latest local Postgres snapshot checked on 2026-07-22:

| Area | Count / Status |
|---|---:|
| Assets | 18,228 stock assets / 18k+ total assets |
| Latest quotes | 17,505 |
| OHLCV bars | 6.2M+ |
| Swing signals | 3,399 |
| Financial report rows | 113,129 |
| Macro indicator rows | 8,161 |
| Fund schemes with snapshots | 12 |
| Fund snapshot rows | 936 |
| Explicit user fund mappings | 6 |
| Forward-test positions | 40 |
| Imported user mutual funds | 21 CAS fund holdings imported in the current local DB |
| Imported user fund value | INR 85,32,803.53 from latest CAS inventory |
| Quote rows with no OHLCV history | Still material, especially long-tail US and some IN symbols |

## Data Sync And Workers

### Startup / Recurring Wrapper

`npm run dev` and `npm run start` use `scripts/run-with-nse-sync.mjs`.

The wrapper currently handles:

- Official NSE/BSE bhavcopy OHLCV catch-up on startup.
- Daily NSE/BSE bhavcopy history sync scheduling by IST time.
- NSE/BSE latest quote refresh every 15 minutes during Indian market hours
  (`09:15-15:30 IST`, Monday-Friday), configurable with
  `INDIA_MARKET_QUOTE_REFRESH_INTERVAL_MINUTES` and disabled with
  `INDIA_MARKET_QUOTE_REFRESH_DISABLED=1`.
- Recurring broader market refresh every configured interval.
- Security listing refresh.
- Quote refresh.
- US quote/fundamental/history sync hooks.
- Macro sync hook.
- Signal scan trigger through cron API.
- Queued OHLCV repair trigger through a detached local worker script.

Known issue:

- NSE/BSE bhavcopy remains end-of-day data. The new 15-minute scheduler keeps
  the app refreshed from the configured source, but true live intraday
  all-stock quotes require an intraday provider beyond bhavcopy.
- Some long-tail Yahoo/Google symbols still emit provider 404/delisted noise.

### Pipeline Scripts

Available scripts:

- `npm run sync:nse-history`
- `npm run sync:fundamentals`
- `npm run sync:us`
- `npm run sync:us-quotes`
- `npm run sync:us-fundamentals`
- `npm run sync:us-history`
- `npm run sync:macro`
- `npm run worker:breeze`

Python/Node data paths include:

- NSE yfinance incremental sync.
- US market quote/history/fundamental sync.
- Google Finance fallback for quotes in selected cases.
- Macro history sync.
- Screener snapshot refresh.
- AMC disclosure extraction and loading.
- CAS PDF extraction.
- Breeze daemon scaffold for websocket OI ingestion.

## Market Overview

Built:

- India and US market overview pages.
- Normalized performance chart.
- TradingView-style candlestick chart powered by `lightweight-charts`.
- OHLCV candle API: `/api/market-overview/candles`.
- Performance/Candles toggle in Market Overview.
- Multi-symbol chart selection.
- Fix for US multi-exchange lookup so NYSE and NASDAQ symbols can both resolve.
- Empty-history handling for symbols without OHLCV coverage.
- Hydration-safe date formatting fix.
- Market Overview now uses the shared app shell instead of the older standalone
  side rail.

Current limitations:

- US OHLCV coverage remains incomplete compared with quote coverage.
- Some data sources can return stale or failed values unless refresh succeeds.
- Real-time quotes are still best-effort, not institutional-grade streaming.

## Swing Candidates / Buy Candidates

Built:

- Page renamed and shaped around Buy Candidates rather than long/short language.
- Uses latest quotes, swing signals, ATR, trigger levels, targets, stops, trailing stop, and expected days.
- Removes static price assumptions from the main candidate display path.
- Integrates per-user risk/settings behavior.
- Probability/strategy engine option has been added into the terminal flow.

Current limitations:

- Candidate quality depends on latest OHLCV and quote freshness.
- Derivatives/OI confirmation is architecturally present, but live Breeze OI feed is not fully operational because Breeze static IP requirements block local-only usage.
- Needs more backtesting/forward-testing feedback loops before commercialization.

## Screener And Fundamentals

Built:

- Stock screener UI and API.
- Hydration-safe screener snapshot timestamp formatting (`en-IN`,
  `Asia/Kolkata`) to avoid server/client locale mismatch.
- Filter engine with test coverage.
- Financial report storage.
- India and US fundamentals sync paths.
- Latest financial snapshot joins for screener analysis.
- Screener snapshot rebuild SQL.

Current local data:

- 113,129 financial report rows are present.

Current limitations:

- Data quality varies by source and symbol.
- Financial statement normalization is still basic.
- Need better source provenance and freshness badges in the UI.
- Need commercial-grade corporate action and restatement handling.

## Fund Overlap X-Ray

Built:

- CAS import page for PDF/text/CSV holdings.
- CAS parser with filtering for obvious AMC-header and disclosure/legal-text artifacts.
- Backup table for rejected/polluted CAS rows: `public.cas_import_rejected_holdings`.
- AMC monthly disclosure importer.
- AMC disclosure parser supports XLSX/CSV/text/PDF paths, with improved full-mode parsing for total portfolio validation.
- Monthly fund snapshot schema using ISIN-based joins only.
- Weight validation with +/-2% tolerance before accepting a snapshot.
- Fund Overlap X-Ray now sits below Buy Candidates and focuses only on useful portfolio information:
  - All uploaded funds.
  - Portfolio value/share per fund.
  - Matched look-through count.
  - Pairwise overlap percentages.
  - Shared stocks highlighted.
  - Stocks inside each matched fund.
  - Pending marker for unmatched funds.
- Fund X-Ray now reads AMC snapshot look-through through explicit `user_fund_mappings` instead of relying on implicit `fund_schemes.asset_id` joins.
- X-Ray includes a “Fix mapping” path into the dedicated mapping screen.

### Fund Mapping

Built:

- Dedicated mapping screen: `/portfolio/fund-mapping`.
- Left panel lists all imported CAS mutual funds from `holdings`, not just funds that already have look-through rows.
- Right panel lists all loaded AMC snapshots from `fund_schemes` / `fund_holdings_snapshot`.
- Auto-suggest matching logic:
  - Exact ISIN match.
  - Ambiguous ISIN detection.
  - Conservative name-similarity suggestions within AMC context.
  - Name-only matches require user confirmation.
- Match actions:
  - Accept suggestion.
  - Reject suggestion.
  - Manual link to any snapshot.
  - Unlink an existing mapping.
  - Bulk auto-accept exact, unambiguous ISIN matches.
- CSV export: `/portfolio/fund-mapping/export`.
- Reusable match vocabulary: Matched, Pending, Ambiguous, No Snapshot, Rejected.
- Reusable component: `components/ui/MatchStatusBadge.tsx`.

Current local data:

- 21 user mutual-fund holdings are active from the latest CAS import.
- 6 funds are currently matched to AMC snapshots.
- 6 explicit `user_fund_mappings` rows are present after migration backfill.
- 473 underlying stock rows are available for matched funds.
- 12 global fund schemes have snapshots.

Current limitations:

- Not all uploaded funds have matched AMC monthly portfolio disclosures yet; the mapping screen now makes this repairable.
- Some CAS-extracted fund names are still messy when there is no clean linked scheme snapshot.
- Matching is intentionally conservative: scheme/fund joining should be by ISIN or explicit mapping, not fuzzy name joins.
- Current mapping coverage remains 6/21 until more AMC disclosures are imported or manually linked.

## Data Health

Built:

- Full dashboard: `/data/health`.
- `/data` and `/data/sync` now redirect to `/data/health`.
- `/admin/sync` remains available and links to the full health dashboard.
- Source health cards for:
  - NSE Quotes.
  - BSE Quotes.
  - NSE OHLCV History.
  - US Quotes.
  - US OHLCV History.
  - US Fundamentals.
  - India Fundamentals.
  - Macro Indicators.
  - AMC Fund Snapshots.
  - CAS Imports.
- Reusable freshness vocabulary: Fresh, Stale, Failed, Unknown, Off-hours.
- Reusable component: `components/ui/FreshnessBadge.tsx`.
- Coverage gap table detects:
  - Quote but no history.
  - History stale.
  - No fundamentals.
  - Stale fundamentals.
  - Quote age.
  - Fund snapshot gap.
  - Swing signal on stale data.
  - Forward-test on stale data.
- Filters by market, severity, and issue type.
- Mobile layout degrades to cards.
- Sync log viewer reads the last 50 rows from `cron_logs` with expandable error/detail JSON.
- Quick-fix guidance shows the relevant command or links to Fund Mapping.
- App shell now shows a small Data Health status dot beside the Data Health nav item.

Current local finding:

- Data Health now reconciles queued backfill rows against existing `daily_ohlcv`
  coverage so the backfill progress bar reflects actual database coverage after
  refresh.
- Quote-without-history remains the biggest data-coverage issue, especially for
  US long-tail names.

Current limitations:

- Quick-fix actions are intentionally conservative: heavy syncs are not auto-triggered from the UI yet.
- Backfill can be started from the UI and continues in the background through
  `scripts/local-backfill-worker.mjs`; progress is visible through the Data
  Health backfill status panel.
- `cron_logs` only stores `created_at` and `duration_ms`, not separate started/finished timestamps.
- Health status is source-level and asset-level, but not yet tied into every candidate/screener row visually.

## Forward Testing

Built:

- Forward-test tables and fill/trigger support.
- Forward-test CLI fixes.
- Scorecard UI.
- Cron scheduling and enrolment.
- Route moved under Portfolio/terminal flow.

Current local data:

- 40 forward-test positions are present.

Current limitations:

- Needs clearer UI explanations of what is enrolled, triggered, filled, won, lost, or expired.
- Needs historical performance summaries per strategy and per market.
- Needs guardrails against stale price data creating false results.

## Macro Lead/Lag

Built:

- Macro indicator storage.
- Macro sync pipeline.
- Cross-asset macro correlator engine.
- Terminal card showing 30/90-day correlations and lead/lag signals.

Current local data:

- 8,161 macro indicator rows are present.

Current limitations:

- Sector proxies are still simple.
- Needs deeper indicator selection, richer visualizations, and explainable signal narratives.
- Needs validation against actual strategy outcomes.

## Breeze / Derivatives OI

Built:

- Local `workers/breeze_daemon.py` scaffold.
- Intended websocket path for BreezeConnect.
- Batch/rate-limit approach for writing OI metrics into local Postgres.

Current limitations:

- Breeze live connection requires static IP / hosted environment approval, so local machine usage is blocked unless Breeze allows the current IP.
- Need cloud deployment option or alternate OI data vendor.
- Until OI is live, OI-validated setups should be treated as partially powered.

## Authentication And Local Use

Built:

- Local auth backed by Postgres.
- Signup/login paths.
- Safe redirect handling.
- Scaffold creation for local user portfolio.
- Local Postgres connection defaults to `postgresql://localhost:5432/investogenie`.

Current limitations:

- Multi-user support exists at the data model level, but the app has not yet been hardened for public multi-user deployment.
- Needs role/admin management, stronger audit logs, and production secret handling before commercialization.

## UI / Navigation

Built:

- Landing page with cinematic terminal style.
- Market choice flow for US and India.
- App shell with terminal navigation.
- Help and About pages.
- More consistent terminal placement for market features.
- Oval landing-page nav clutter removed from core app navigation.

Current limitations:

- Some pages still overlap conceptually: `/markets/[market]`, `/terminal/[market]`, and `/app/[market]` should be consolidated.
- Needs one commercial-grade navigation model:
  - Dashboard / Terminal
  - Markets
  - Screener
  - Swing Candidates
  - Portfolio
  - Data Sync
  - Settings
  - Help/About

## Quality Checks Currently Passing

Recent checks after Fund Mapping and Data Health implementation:

- `npm run lint`: passing.
- `npx tsc --noEmit`: passing.
- `npm test`: passing, 30/30 tests.
- `npm run build`: passing cleanly under Turbopack.

Recent verified command set on 2026-07-22:

- `node --check scripts/run-with-nse-sync.mjs`: passing.
- `node --check scripts/local-backfill-worker.mjs`: passing.
- `npx tsc --noEmit`: passing.
- `npm run lint`: passing.
- `npm run build`: passing with no Turbopack warning.

## Git State At Time Of This File

Current branch:

- `feat/fund-xray-schema`

Recent local commits ahead of remote:

- `79b6a9a Refresh India quotes during market hours`
- `7abfe6d Use lightweight market charts and clean build`
- `bdec47b Add TradingView-style market candles`
- `deb66da Automate bhavcopy sync on startup`
- `7c01fa8 Add data health and fund mapping workflows`

Committed app work now includes:

- Explicit fund mapping schema and UI.
- Data Health dashboard and status badges.
- Bhavcopy startup automation.
- TradingView-style charting with `lightweight-charts`.
- Clean Turbopack build by moving local backfill execution to a detached worker.
- 15-minute market-hours NSE/BSE quote refresh.
- Stock screener hydration fix.

Uncommitted non-app files observed:

- `.claude/context/...`
- `CLAUDE.md`

Uncommitted app file observed:

- `STATUS.md` itself after this update.

These appear to be Claude/context notes rather than app functionality.

## Recommended Build Next

### 1. Complete Fund Mapping Coverage

Use the new `/portfolio/fund-mapping` screen to move Fund X-Ray from 6/21 matched funds toward full coverage.

Next actions:

- Import missing AMC monthly portfolio disclosures for unmatched funds.
- Use exact ISIN matches where available.
- Manually link ambiguous funds.
- Keep rejected suggestions as signal for parser/matcher cleanup.
- Once mappings improve, verify Fund X-Ray overlap and shared-stock output again.

### 2. Repair Startup Refresh Robustness

Make `scripts/run-with-nse-sync.mjs` and listing/quote ingestors resilient:

- Treat BSE/NSE malformed response as a warning, not a noisy crash.
- Add retry/backoff.
- Add source-specific user agents and redirect handling.
- Persist sync failure details to `cron_logs`.
- Continue remaining jobs even if one source fails.

### 3. Complete US History Coverage

US quote coverage is much larger than US OHLCV coverage.

Next action:

- Backfill S&P 500 first.
- Then NASDAQ 100.
- Then liquid NYSE/NASDAQ names by volume.
- Surface “no history yet” clearly in charts and candidate screens.

### 4. Commercial Navigation Pass

Unify app routes and reduce conceptual duplication.

Recommended final nav:

- Home
- Terminal
- Markets
- Screener
- Swing Candidates
- Portfolio
- Forward Test
- Data Health
- Settings
- Help
- About

### 5. Strategy Validation Layer

Before public launch, every strategy should expose:

- Current signal.
- Why it fired.
- Data freshness.
- Historical hit rate.
- Forward-test status.
- Average gain/loss.
- Drawdown.
- False-positive count.

### 6. Production Readiness

Needed before additional users:

- Proper hosted Postgres or managed database.
- Migration runner in deployment flow.
- Secrets management.
- Auth hardening.
- Rate limiting.
- User isolation audit.
- Backups.
- Error tracking.
- Terms/disclaimers for financial analysis.
- Clear “not investment advice” positioning.

## Useful Commands

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Start production build:

```bash
npm run start
```

Checks:

```bash
npm run lint
npx tsc --noEmit
npm test
```

Manual syncs:

```bash
npm run sync:nse-history
npm run sync:fundamentals
npm run sync:us
npm run sync:us-history
npm run sync:macro
```

Breeze worker:

```bash
npm run worker:breeze
```

## Bottom Line

InvestoGenie is no longer a simple prototype. It now has a serious local market-data backend, multi-market terminal UI, strategy/candidate engines, portfolio import, Fund X-Ray, financials, macro data, and forward testing.

The biggest next unlock is not another strategy screen. It is data trust:

1. Finish mapping/import coverage for every uploaded fund.
2. Use Data Health to drive quote/history/fundamental repair work.
3. Fill missing OHLCV history.
4. Tie each strategy to forward-tested evidence.

Once those are strong, the app becomes much easier to commercialize.
