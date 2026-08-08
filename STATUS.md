# InvestoGenie Status

_Last updated: 2026-08-08 (added normalized annual company statements and an Oracle Cloud Always Free production deployment package; 96 tests, lint, typecheck and production build clean)_

This file summarizes what has been built so far, what is currently working, what is partial, and what to build next.

## Product Direction

InvestoGenie is now a local-first market terminal and portfolio intelligence app for Indian and US markets. The current build focuses on:

- Market overview and charting for India and US.
- Buy candidate discovery for swing trading.
- Long-horizon fundamentals screening against six well-known investors' published criteria.
- Rule-based and probability-style strategy screens.
- Local Postgres as the system of record.
- Recurring quote/history/fundamental/macro sync jobs.
- Portfolio import and Fund Overlap X-Ray using CAS and AMC disclosures.
- Forward-testing infrastructure to judge strategies out of sample.
- Data coverage visibility and repair workflows for fund mappings, source freshness, and stale strategy inputs.

### Local and Oracle deployment readiness

- `deploy/local/` documents the existing macOS one-click/development deployment, while
  `deploy/oracle/` provides Ubuntu bootstrap, systemd, Nginx, production environment template,
  release update, PostgreSQL backup, HTTPS and local-database transfer instructions.
- `scripts/check-deployment.mjs` validates secrets, runtime, build artifact and database isolation;
  the live Mac passes 10/10 local checks and a production-profile simulation passes 12/12.
- Recommended target is one home-region `VM.Standard.A1.Flex` ARM VM with 2 OCPUs, 12 GB RAM,
  a 100 GB boot volume and a reserved public IP. PostgreSQL and Next.js remain private behind Nginx.
- Current local sizing is approximately 1.9 GB for PostgreSQL and 2.4 GB for the development
  workspace, so the target has substantial initial storage headroom. Cloud deployment still
  requires the intended revision to be committed/pushed and an OCI VM/domain to be provisioned.

## Current App Surfaces

### Public / Orientation

- Landing page: `/`
- Help & knowledge base: `/help` (guided walkthrough + article index), `/help/[slug]` (13 articles)
- About page: `/about`
- Login: `/login`

### Terminal Workspaces

- India terminal: `/terminal/in`
- US terminal: `/terminal/us`
- New market workspace route family: `/app/[market]`
- Market overview route: `/markets/[market]`
- Stocks route: `/terminal/[market]/stocks`
- Screener route: `/terminal/[market]/screener` (with NL query support)
- Long-Term Candidates route: `/terminal/[market]/long-term`
- Probability route: `/terminal/[market]/probability`
- Forward-test route: `/terminal/[market]/forward-test`
- Import holdings / CAS route: `/terminal/in/cas`

### Portfolio / Data / Admin

- Portfolio pages: `/portfolio`, `/portfolio/import`, `/portfolio/fund-mapping`, `/portfolio/fund-xray`
- Data pages: `/data`, `/data/sync`, `/data/health`
- Admin sync page: `/admin/sync`
- Settings: `/settings` (includes email digest preferences)
- Email digest cron: `/api/cron/send-email-digest`

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
- `0018_backfill_queue.sql`: queued OHLCV/history repair jobs.
- `0019_cas_holding_details.sql`: CAS holding details such as folio/ISIN metadata.
- `0020_email_preferences.sql`: user email digest opt-in settings (send time, screen toggles, last sent timestamp).
- `0021_user_credentials.sql`: per-user encrypted credentials (SMTP password, AI API keys) via AES-256-GCM.
- `0022_ai_provider_config.sql`: active AI provider/model/key selection for the NL screener (Anthropic/OpenAI/Google).
- `0023_amfi_scheme_master.sql`: option-level AMFI scheme registry plus the many-ISIN-to-one-portfolio identifier bridge.
- `0024_us_history_sync_state.sql`: per-symbol attempt tracking for the US history sync, so batch selection rotates by attempt time instead of data staleness (see US History Coverage → 4c).

## Current Local Data Coverage

Latest local Postgres snapshot checked on 2026-08-02:

| Area | Count / Status |
|---|---:|
| Assets (all classes/markets) | 16,689 |
| Latest quotes | 16,218 |
| OHLCV bars | 7,730,751 |
| Swing signals | 10,923 |
| Financial report rows | 126,390 |
| Macro indicator rows | 8,195 |
| Cron log rows | 689 |
| US active stock assets | 9,044 (no-history OTC permanently excluded 2026-07-24 — see US History Coverage → OTC exclusion) |
| US assets with OHLCV history | 8,703 / 9,044 (96.2%) |
| **US assets with *fresh* history (≤3 days)** | **355 / 8,703 — mid-recovery from the 4c starvation regression (was 53; ~2.4 days to full drain)** |
| US history sync rotation state rows | 323 and climbing (new in 0024; one per symbol attempted) |
| India active stock assets | 7,563 |
| India assets with OHLCV history | 7,284 / 7,563 (96.3%) |
| US fundamentals coverage | 5,449 assets with a latest financial report |
| India fundamentals coverage | 6,507 assets with a latest financial report |
| US swing scan: scanned / buy candidates | 7,863 / 1,071 |
| India swing scan: scanned / buy candidates | 2,946 / 450 |

Fundamentals coverage above is counted via `latest_financials` (one row per asset, its most
recent report) — the 2026-07-24 snapshot's US/India figures (6,227 / 6,965) were computed
differently and did not match a same-day re-check; the numbers here are the verified figures
as of this snapshot.

Portfolio/fund figures below were refreshed on 2026-07-25 where the current DB exposes them; forward-test count remains from the earlier local snapshot:

| Area | Count / Status |
|---|---:|
| Fund schemes with snapshots | 12 |
| AMFI scheme-master rows | 14,222 total / 8,657 active |
| Fund scheme identifiers | 100 identifiers across all 12 loaded snapshots |
| CAS holdings with exact snapshot ISIN match | 11 / 21 |
| Fund snapshot rows | 936 |
| Explicit user fund mappings | 5 matched mappings |
| Forward-test positions | 40 |
| Imported user mutual funds | 21 CAS fund holdings imported in the current local DB |
| Imported user fund value | INR 85,32,803.53 from latest CAS inventory |

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
- Security listing refresh (`scripts/ingest-listings.mjs`; excludes US OTC listings from
  ingestion since 2026-07-24 — see US History Coverage → OTC exclusion).
- Quote refresh.
- US quote/fundamental/history sync hooks (`US_HISTORY_LIMIT=150`/hour since 2026-07-24).
  Batch selection rotates by `last_attempt_at` via `us_history_sync_state`, not by data
  staleness — see US History Coverage → 4c for the starvation regression that made this
  necessary.
- Macro sync hook.
- Signal scan trigger through cron API.
- Queued OHLCV repair trigger through a detached local worker script.
- Official AMFI scheme-master sync at startup and daily at 06:30 IST. The time is
  configurable with `AMFI_SCHEME_SYNC_HOUR_IST` / `AMFI_SCHEME_SYNC_MINUTE_IST`;
  set `AMFI_SCHEME_SYNC_DISABLED=1` to disable it.
- Daily email digest trigger at 07:00 IST (configurable via `EMAIL_DIGEST_HOUR_IST` /
  `EMAIL_DIGEST_MINUTE_IST`, disabled with `EMAIL_DIGEST_CRON_DISABLED=1`), calling
  `/api/cron/send-email-digest` with the `CRON_SECRET` bearer. Resilient to a failed
  or missed window — see Email Digest → Scheduling resilience.

Known issue:

- NSE/BSE bhavcopy remains end-of-day data. The new 15-minute scheduler keeps
  the app refreshed from the configured source, but true live intraday
  all-stock quotes require an intraday provider beyond bhavcopy.
- Some long-tail Yahoo/Google symbols still emit provider 404/delisted noise.

### Pipeline Scripts

Available scripts:

- `npm run sync:nse-history`
- `npm run sync:amfi-schemes`
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

- US OHLCV coverage is strong at 95.0% of active stocks (8,991 total, 8,543 with history)
  after the 2026-07-24 backfill and permanent OTC exclusion (see US History Coverage → OTC
  exclusion). India coverage is strong at 96.3% (7,563 total, 7,284 with history).
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

## Long-Term Investment Candidates

Built and strengthened (2026-08-08):

- New route `/terminal/[market]/long-term`, in the sidebar under Market Workspace directly
  after Swing Candidates.
- Scores the full fundamentals-covered stock universe directly, without importing or changing
  the Stock Screener, Swing Candidates or Probability flows. Live coverage is 4,356 India and
  6,722 US stocks. Six long-horizon investor-inspired rankings are available: Lynch GARP,
  Buffett moat, Graham defensive, Fisher growth, Templeton contrarian, Greenblatt magic formula.
- `lib/long-term-data.ts` reads annual and quarterly financial reports, normalized annual balance
  sheets/cash flows, latest quotes and OHLCV; derives 3/5-year revenue/profit CAGR, observed median
  ROCE, profit consistency, cash conversion, FCF margin, liquidity, leverage, interest coverage,
  price-to-book and EBIT/enterprise-value yield. Currency-sensitive valuation is suppressed when
  the report and quote currencies do not match (notably ADRs).
- `lib/analytics/longTermStrategies.ts` uses smooth weighted criterion scores rather than binary
  pass-count saturation. Evidence confidence incorporates data completeness, report age and
  annual-history depth. Financials/insurers/REITs are excluded until sector-correct ratios exist,
  and INR 500 Cr / USD 50M investability floors remove tiny names.
- `lib/long-term-actions.ts` — `getLongTermCandidates()` server action: scores, filters by
  one selected strategy, minimum score and minimum evidence, then ranks by score/confidence.
  A five-minute server cache reduces repeated filter/strategy requests from 7–8 seconds to
  26–88 ms in live checks.
- `components/long-term/StrategyBadge.tsx`, `components/long-term/LongTermCandidatesClient.tsx`
  — single-strategy selector, score/evidence sliders, true report/quote dates, history depth and
  expandable per-criterion values and smooth scores.
- `0025_long_term_score_snapshots.sql` stores an atomic daily top-200 strategy ranking and exposes
  `long_term_forward_performance`, establishing a point-in-time measurement trail. Current live
  capture verified at exactly ranks 1–50 for India and US under Buffett Moat.
- 7 help articles (`lib/help/articles.tsx`): an engine overview plus one per strategy, each
  disclosing adaptations. Graham now uses real current ratio, price-to-book and interest coverage;
  Greenblatt uses EBIT/current enterprise value; Buffett/Fisher/Lynch use cash conversion evidence.
- `0026_company_statement_details.sql` adds `asset_balance_sheets`,
  `asset_cash_flow_statements`, richer income-statement columns and an auditable latest-health view.
  The India and US Yahoo pipelines now upsert these statements by asset, period and report type.
  Yahoo supplied five annual periods for the live TCS/AAPL samples; the schema supports retaining
  more when a provider exposes it, but the app does not claim a ten-year balance-sheet history.
- Recurring statement expansion is incremental: India and US default to 250 companies per run,
  with environment overrides available. Until that backfill completes, missing statement evidence
  lowers confidence rather than being fabricated.
- Reused, not rewritten: the user supplied 5 reference files from an unrelated codebase as
  design inspiration (shadcn/ui components, a `pb_ratio` field, raw `db.connect()` calls) —
  none of those conventions matched this app, so the feature was built against this repo's
  actual patterns (screener field registry, `"use server"` + `query()`, Tailwind terminal
  styling) instead of adapted from the reference code.

Explicit constraint honored: this repair does not modify Stock Screener, Swing Candidates or
Probability code. The working-tree diff contains only Long-Term files, its migration/help copy,
and documentation, apart from pre-existing `.claude` bookkeeping changes.

Verified: `tsc`/`eslint` clean, 94/94 tests pass, production build clean, migration applied, and
both markets queried against local PostgreSQL. Buffett live leaders included GARUDA/TCS/
HEROMOTOCO for India and INFY/DLO/ITRN for US with realistic current P/E values. The server action
also returned the distinct Lynch ranking IRIS/OSWALPUMPS/JINDRILL.

Current limitations:

- No India/US worked-example prose in the help articles yet (same gap as the existing swing
  strategy articles).
- Approximated criteria (PEG, moat, contrarian and Magic Formula proxies) are disclosed but not
  yet validated against each investor's historical hit rate.
- Daily score/price snapshots now exist, but a benchmark-relative 1/3/6/12-month scorecard and
  survivorship-safe historical backtest UI still need to be built.
- Full-market balance-sheet/cash-flow coverage is still backfilling. Live validation currently
  covers TCS on NSE/BSE and AAPL; this verifies the ingestion and calculations, not universe-wide
  completeness.

## Screener And Fundamentals

Built:

- Stock screener UI and API.
- Hydration-safe screener snapshot timestamp formatting (`en-IN`,
  `Asia/Kolkata`) to avoid server/client locale mismatch.
- Filter engine with comprehensive test coverage.
- Financial report storage.
- India and US fundamentals sync paths.
- Latest financial snapshot joins for screener analysis.
- Screener snapshot rebuild SQL.
- **Natural Language Query feature:**
  - `NlQueryBar.tsx` component for plain-English screener queries.
  - **Multi-provider** dispatch in `nlQuery.ts` — user picks Anthropic (Claude), OpenAI (GPT), or Google (Gemini) with a preset-or-custom model in Settings → AI model; the query runs against the chosen provider/model/key. Anthropic uses the SDK's native structured output; OpenAI uses Chat Completions JSON mode; Google uses Gemini `generateContent` JSON. Provider registry in `lib/ai/providers.ts`; key resolution in `getActiveAIConfig()`.
  - Three-layer validation applied to EVERY provider's output: Zod shape → validateFilter → sanitizeIntent.
  - Unit conversion handling (Rs. Crore vs USD millions, percents vs ratios).
  - One-turn repair loop for parse failures.
  - Comprehensive test suite covering sanitization, sector/universe validation, bounds swapping.
  - Prompt caching on system rules (Anthropic path) for performance.
  - `ScreenIntent` JSON: filters, sort, universe, valueBelowSectorMedian, search, and explanatory notes.

Current local data:

- 126,390 financial report rows are present.

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
- **"Same stock across multiple funds" panel (2026-08-02).** The engine had always computed
  cross-fund duplication (`stockExposure[].contributingFunds`), but only used it to amber-tint
  rows inside each fund's own card — so answering "which stocks do I hold through more than one
  fund, and what do they add up to" meant reading every fund card and cross-referencing by eye.
  There is now a dedicated panel listing every duplicated holding, sorted by fund count then
  combined weight, showing the stock, how many funds hold it, its effective portfolio-level
  weight, and which funds. Live data: **57 duplicated stocks**, three held by all 4 mapped funds
  (United Spirits, Godrej Consumer, Eternal), ICICI Bank the largest combined exposure at 2.04%.
  The weight shown is effective portfolio exposure (true combined concentration), not the
  within-fund weight — labelled inline so the number is unambiguous.
- **Empty state corrected (2026-08-02).** It previously said "No fund holdings imported yet."
  for two different situations, since the page redirects when signed out: genuinely nothing
  imported, and — misleadingly — funds imported but none mapped to an AMC disclosure. These are
  now distinct: no holdings links to CAS import; holdings-but-no-mappings states how many funds
  are imported, explains unmapped funds have no underlying stocks to compare, and links to fund
  mapping.

### Fund Mapping

Built:

- Dedicated mapping screen: `/portfolio/fund-mapping`.
- Left panel lists all imported CAS mutual funds from `holdings`, not just funds that already have look-through rows.
- Right panel lists all loaded AMC snapshots from `fund_schemes` / `fund_holdings_snapshot`.
- Official AMFI scheme-master sync (`npm run sync:amfi-schemes`) stores every plan/option row, both AMFI ISIN columns, NAV, AMC/category context, and active/stale state.
- `fund_scheme_identifiers` bridges many plan/option ISINs and AMFI codes to one portfolio-level `fund_schemes` snapshot.
- Auto-suggest matching logic:
  - Exact ISIN match across every bridged plan/option identifier.
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
- **"Fund vs fund overlap" block (2026-08-02).** Pairwise overlap previously existed only on
  the terminal X-Ray, but Fund Mapping is where mapping decisions are actually made — so the
  payoff for accepting a mapping, and the reason to go find the next AMC disclosure, was
  invisible on the screen that matters. There is now a block directly under the summary tiles:
  one row per pair with both fund names, the overlap percentage, and the shared-stock count,
  expanding to the full stock list. Pairs ≥30% are flagged "heavy duplication" and coloured,
  matching the X-Ray threshold; the top pair is expanded by default so the block is useful
  without a click. It calls `getFundOverlap()` rather than recomputing locally — mapping and
  the X-Ray must never disagree about the same numbers. The empty state separates the two real
  cases: fewer than two mapped funds explains that overlap needs a pair and says how many are
  mapped; two-or-more with nothing shared says so plainly.

Current local data:

- 21 user mutual-fund holdings are active from the latest CAS import.
- 5 funds are currently accepted in `user_fund_mappings`.
- The AMFI bridge produces exact snapshot coverage for 11 of 21 CAS holdings; 6 exact suggestions remain available through the bulk auto-accept action.
- With 5 funds mapped, the overlap engine produces **10 fund pairs**, led by ICICI Prudential Large Cap ↔ HDFC Flexi Cap at **47.1% (32 shared stocks)** — visible on both the Fund Mapping screen and the terminal X-Ray.
- The other 10 CAS holdings have valid AMFI identities but no corresponding loaded AMC snapshot yet.
- All 12 loaded snapshot schemes resolved to AMFI families, producing 100 identifiers with zero ownership conflicts.
- Underlying stock rows are available after an exact suggestion is accepted; full X-Ray power still depends on importing the missing AMC disclosures.

Current limitations:

- Not all uploaded funds have matched AMC monthly portfolio disclosures yet; the mapping screen now makes this repairable.
- Some CAS-extracted fund names are still messy when there is no clean linked scheme snapshot.
- Matching is intentionally conservative: scheme/fund joining should be by ISIN or explicit mapping, not fuzzy name joins.
- Accepted mapping coverage is 5/21; identifier coverage is 11/21. Six exact suggestions remain actionable, while the other 10 require AMC disclosure snapshots.

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

### Fixed: NSE/BSE weekend false-staleness (2026-07-26)

**Symptom:** Friday's NSE/BSE close is the correct, current data all weekend (markets are shut
Sat/Sun) — but two separate places were computing staleness as a flat "days/hours since now"
count with no awareness that the market was closed, not broken:

1. **Source health cards** — "NSE OHLCV History" / "BSE OHLCV History" used the generic
   24-hour-cadence `classifyFreshness` (same as any other job). Friday's data would show
   "stale" by Saturday (>24h old) and **"failed" by Monday** (>72h old) — even though nothing
   was actually wrong.
2. **Per-symbol gaps** — `classifyCoverageGaps`'s `staleHistory` used a flat `> 3` raw calendar
   days for both markets. This happened to *coincidentally* tolerate most of the weekend (3
   raw days roughly spans Fri→Mon) but wasn't a real rule — it doesn't know about holidays and
   would flag inconsistently depending on exact check time.

**Fix:** reused the `expectedIndianBhavcopyDate()` helper already built for the IN quote-staleness
check (weekday + after-18:00-IST-publication-window logic) for OHLCV history too, on both the
source cards and the per-symbol gap. Friday's data now reads as `fresh` through the whole
weekend and Monday morning, degrades to `stale` only once Monday's own session has closed with
no Monday bar yet (normal same-evening provider lag, not a real outage), and only escalates to
`failed` after a genuinely stuck multi-day gap.

**A real bug was caught mid-fix, not just designed around:** the first implementation attempt
compared `last_success_at` (a `timestamptz`) after routing it through `new Date(...).toISOString()`
— that round-trip shifts the calendar day by the host's local UTC offset. Verified live: a
`2026-07-24` (IST) bar came back as `"2026-07-23"` after the round-trip, which would have
silently broken the very fix being added. Corrected by casting the bar date to `::text` directly
in SQL (matching how `quote_as_of` was already handled safely) instead of deriving it from a JS
`Date`, and added test coverage asserting the correct value specifically to guard against this
recurring.

Files: `lib/dataHealth.ts` (`classifyCoverageGaps`, `classifySourceFreshness`,
`getCoverageGaps`, `getDataHealthSummary`), `lib/dataHealth.test.ts` (+5 tests: weekend
non-staleness, Monday-evening degrade-to-stale-not-failed, multi-day genuine failure).

Verified: 81/81 tests passing (+5 new), `tsc`/`eslint` clean, build clean, and cross-checked
against the live database at three real timestamps (Sunday now, Monday 10:00 IST, Monday 19:00
IST) using the actual current Friday bar date — confirmed fresh/fresh/stale respectively, not
the previous stale/failed/failed.

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

## Email Digest

Built:

- Daily morning email with the top 5 Swing Candidates and top 5 Probability forecasts.
- User opt-in via Settings → Email digest, with 7 AM IST default send time.
- Configurable send time and per-section toggles (include swing candidates, include probability).
- **Correct data sources — the digest reads the SAME engines that power the on-screen views:**
  - Swing section calls `runScreener("IN", { ...DEFAULT_SETTINGS, includeShort: false }, { exchange: "NSE", limit: 20 })` and takes the top 5, so the email rows match the Swing Candidates screen exactly (verified: AMDIND, CARERATING, FIEMIND, GRPLTD, HEROMOTOCO in order). `limit: 20` (the screen's cap) is used rather than 5 so SHORT-biased rows filtered out of the top scores don't starve the buy-only list.
  - Probability section calls `getProbabilitySummary("IN").rows.slice(0, 5)`, already ranked by probability of an up move — same source as the Probability screen.
  - (An earlier version incorrectly used `getScreenerResults()`, a generic fundamentals screener unrelated to either screen; that is fixed.)
- **Two distinct, mobile-responsive card layouts** in `lib/email/digest-template.ts`:
  - Swing card: BUY/SELL badge, price + day change, Entry / Target / Stop / Trail, R:R, ~Days, P/E, ROCE, score.
  - Probability card: price + day change, Prob-Up (21d), Expected Return, Volatility, Drawdown Risk, Median (p50) target price.
  - Responsive `@media` rules so cards render cleanly on mobile and desktop.
- **Encrypted per-user credentials** (`user_credentials` table): SMTP password plus the active AI provider/model/key, encrypted with AES-256-GCM (`lib/crypto/credentials.ts`, master key in `CREDENTIAL_ENCRYPTION_KEY`). Managed in Settings → Secured credentials (`components/settings/CredentialsForm.tsx`) with a provider dropdown, a preset-or-custom model dropdown, and a key field. Digest send decrypts the stored SMTP password on demand.
- Nodemailer SMTP integration via `sendEmailWithConfig()` (per-user DB credentials), supporting Gmail (app password), Outlook, SendGrid, or any SMTP provider.
- Cron endpoint `/api/cron/send-email-digest`, secured by `CRON_SECRET`. Scheduled **in-app** by the startup wrapper `scripts/run-with-nse-sync.mjs` (07:00 IST daily, same tick that drives the scan/backfill/quote jobs); external schedulers (cron-job.org, Vercel crons) remain an option for bare deploys.
- **Scheduling resilience** (added after a real 07:00 miss — the send failed with
  `getaddrinfo ENOTFOUND smtp.gmail.com` because the machine was waking and DNS was not up):
  - **Retry on failure.** The "sent today" date is recorded only on a clean success, so a
    transient error no longer burns the day. Bounded budget: `EMAIL_DIGEST_MAX_ATTEMPTS`
    (default 5) attempts spaced `EMAIL_DIGEST_RETRY_MINUTES` (default 5) apart.
  - **Catch-up on startup.** Startup seeds from the DB (`max(last_sent_at)` over enabled
    users) instead of assuming "past target = already sent". No digest today → send a
    catch-up immediately; already sent → wait for tomorrow. Covers a machine that was
    asleep/offline at the target time.
  - **`"partial"` counts as a failure.** A 200 response where some recipients errored now
    engages the retry path rather than closing the day.
  - Verified live: catch-up detected and delivered (`status: success, sent: 1, errors: 0`).
- Graceful degradation: if one user's email fails, others still send; `last_sent_at` updated per user.
- Full logging to `cron_logs` (job `send-email-digest`) with send counts and per-recipient errors.

Verified end-to-end: real email delivered to the account inbox; swing rows match the screen; 76/76 tests pass; `tsc` and build clean.

Files:

- `lib/email-actions.ts` — preferences CRUD + `sendEmailDigest()`.
- `lib/email/digest-template.ts` — HTML template with swing/probability cards.
- `lib/email/nodemailer-service.ts` — `sendEmailWithConfig()` transporter.
- `lib/credentials-actions.ts` + `lib/crypto/credentials.ts` — encrypted credentials.
- `components/settings/EmailPreferencesForm.tsx`, `components/settings/CredentialsForm.tsx` — Settings UI.
- `app/api/cron/send-email-digest/route.ts` — daily cron endpoint.
- Migrations `0020_email_preferences.sql`, `0021_user_credentials.sql`, `0022_ai_provider_config.sql`.

Environment / activation:

- `CREDENTIAL_ENCRYPTION_KEY` (required) — AES master key; generate with `openssl rand -hex 32`.
- `CRON_SECRET` — authorizes the cron endpoint.
- SMTP is stored per-user in `user_credentials` via Settings (env `SMTP_*` remain a fallback).
- Schedule `/api/cron/send-email-digest` for 7 AM IST (02:30 UTC) in the deployment cron.
- Docs: `docs/EMAIL_SETUP.md`, `docs/SECURE_CREDENTIALS.md`, `docs/QUICK_START_CREDENTIALS.md`.

Current limitations:

- Requires external cron service or cloud platform scheduling (Vercel, Render, etc.).
- Fixed IN market and top-5 count; no per-user custom filters or market selection in the digest yet.
- Retries are same-day and bounded (5 attempts, 5 min apart) — a provider outage lasting
  longer than that window still loses the day; there is no persistent retry queue.
- The in-app scheduler only fires while the app is running. Startup catch-up covers a
  machine that was asleep at the target time, but a digest that must arrive at 07:00
  regardless of the laptop needs an always-on host (or the external/Vercel cron option).
- Styling is inline-CSS card based; some niche email clients may render differently.

## Macro Lead/Lag

Built:

- Macro indicator storage.
- Macro sync pipeline.
- Cross-asset macro correlator engine.
- Terminal card showing 30/90-day correlations and lead/lag signals.

Current local data:

- 8,195 macro indicator rows are present.

Current limitations:

- Sector proxies are still simple.
- Needs deeper indicator selection, richer visualizations, and explainable signal narratives.
- Needs validation against actual strategy outcomes.

## Help & Knowledge Base

Built (2026-07-24):

- Replaced the single-page Help section with a professional, blog-style knowledge base.
- **`/help`** — a guided, numbered walkthrough of the whole app in the order it's meant to be
  used (Pick a market → Overview → Screener → Swing Candidates → Probability → Import Holdings
  → Data Health), each step linking straight into the live app, plus a categorized index of
  every reference article.
- **`/help/[slug]`** — 7 statically generated article pages (`generateStaticParams`, 404 on
  unknown slugs), each with its own metadata:
  - `swing-engine` — the shared classifier (Bollinger squeeze / Donchian breakout / OI
    build-up scoring) and the ATR-based entry/target/stop/trailing-stop level engine.
  - One article per legendary strategy: `qullamaggie-momentum`, `minervini-vcp`,
    `darvas-box`, `ptj-200-day-trend`, `simons-quant-reversion` — each names the source
    trader, cites where the method is documented, and reproduces the exact match
    conditions/entry formula as implemented.
  - `probability-method` — the full cross-sectional factor model (momentum/snapback/
    volatility → expected return → P(up) → Student-t price range), including the
    "calibration pending" caveat already present in the underlying code.
- Shared component library `components/help/HelpLayout.tsx` (blog chrome, formula blocks,
  spec tables, callouts, numbered steps, references list) and content registry
  `lib/help/articles.tsx`.
- Every formula and threshold was pulled directly from `lib/analytics/swingClassifier.ts`,
  `lib/analytics/legendaryStrategies.ts`, and `lib/probability-runtime.ts` — not written from
  general knowledge — and the app's own approximations (e.g. Minervini's RS-rank-70 substituted
  with a 6-month return proxy) are disclosed rather than glossed over.

Verified: `tsc` clean, `eslint` clean, 76/76 tests, production build generates all 7 static
article pages, all routes 200 (unknown slug 404s), formula/table rendering spot-checked live
in-browser.

Current limitations:

- Content is static (compiled into the article registry); updating it requires a code change,
  not a CMS edit.
- No search across articles yet — navigation is via the hub's categorized index only.
- Articles are IN/US-agnostic prose; no per-market worked examples yet.

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

Full-repo check run on 2026-08-06 (Long-Term Investment Candidates):

- `npx tsc --noEmit`: passing.
- `npx eslint .` on the new/modified files: passing, no errors or warnings.
- `npm test`: passing, **86/86 tests**.
- `npm run build`: passing; new `/terminal/[market]/long-term` dynamic route and 7 new
  `/help/[slug]` static article pages generated.
- Live-database render check: `/terminal/in/long-term` confirmed in-browser — nav placement
  under Market Workspace, real scored candidates, working strategy filter chips and min-score
  slider, expandable criteria breakdown rendering pass/fail rows correctly.
- `git diff --stat` confirmed zero changes to any swing-candidate or probability file, per the
  explicit constraint on this task.

Full-repo check run on 2026-08-02 (fund-vs-fund overlap on Fund Mapping):

- `npx tsc --noEmit`: passing.
- `npx eslint .` (whole repo): passing, no errors or warnings.
- `npm test`: passing, **86/86 tests**.
- `npm run build`: passing.
- Live-database render check: the new block resolves to 10 pairs from 5 mapped funds
  (top pair 47.1%, 32 shared stocks). Not visually confirmed in a browser — the page requires
  sign-in and entering credentials is out of scope, so verification is data- and build-level.

Full-repo check run on 2026-08-02 (US history starvation fix):

- `.venv/bin/python -m py_compile pipelines/us_history_sync.py`: passing.
- `npx tsc --noEmit`: passing.
- `npx eslint .` (whole repo): passing, no errors or warnings.
- `npm test`: passing, **86/86 tests**.
- `npm run build`: passing; 16/16 static pages.
- Live-database behavioural checks (the part unit tests cannot cover here): three consecutive
  runs processed disjoint symbol sets; two production-size runs wrote 1,671 and 1,715 bars;
  backoff verified eligible/excluded across a 5-case matrix including the 14-day cap.

Full-repo check run on 2026-08-01 (AMFI automation and lint cleanup):

- `npm run lint`: passing with no errors or warnings.
- `npx tsc --noEmit`: passing.
- `npm test`: passing, **86/86 tests**.
- `npm run build`: passing; all 16 static pages generated and all dynamic routes recognized.

Full-repo check run on 2026-07-26 (NSE/BSE weekend-staleness fix):

- `npx tsc --noEmit`: passing, no type errors.
- `npm test`: passing, **81/81 tests** (+5 new: weekend non-staleness, Monday-evening
  degrade-to-stale, multi-day genuine failure, both at the per-symbol-gap and source-card level).
- `npm run build`: passing cleanly under Turbopack with all routes recognized.
- `npx eslint lib/dataHealth.ts lib/dataHealth.test.ts`: clean.

Full-repo check run on 2026-07-25:

- `npx tsc --noEmit`: passing, no type errors.
- `npm test`: passing, 76/76 tests.
- `npm run build`: passing cleanly under Turbopack with all routes recognized.
- `npx eslint .` originally found 6 errors and 1 warning. These historical findings
  were resolved on 2026-08-01 with typed sync summaries, safe cron-detail narrowing,
  removal of the unused import, and `next/link` for internal landing-page navigation.

Earlier verified command set on 2026-07-24 (US history sync + OTC exclusion work):

- `node --check scripts/run-with-nse-sync.mjs`: passing.
- `.venv/bin/python -m py_compile pipelines/us_history_sync.py`: passing.
- `npx tsc --noEmit`: passing, no errors.
- `npm test`: passing, 76 tests.
- `npm run build`: passing with all routes generated.

## Git State At Time Of This File

Current branch:

- `main`

Recent commits:

- `6545628 Add Long-Term Investment Candidates under Market Workspace`
- `23d7f5d Update auto-generated session context bookkeeping`
- `76713b0 Fix incremental US history sync: covered symbols never refreshed, throughput too low`
- `d3c217d Permanently exclude OTC from US listings; re-purge and update docs`
- `c401b1d Refresh STATUS.md and CAPABILITIES.md to current state (2026-07-24)`
- `9608c77 Expand Help into a professional blog-style knowledge base`
- `69774c4 STATUS.md: soften stale US OHLCV coverage limitation`
- `7038a78 STATUS.md: record US OTC purge (1,721 no-history assets removed)`
- `cf6dc8f US OHLCV bulk backfill complete (2026-07-24)`
- `18ca155 Update STATUS.md: digest scheduling resilience`

(Pushed to `origin/main`.)

Committed app work now includes:

- Incremental US history sync fix: the recurring refresh job was permanently excluding any
  ticker that ever crossed 260 bars (regardless of staleness) and throttled to 50/hour; fixed
  the selection query (staleness-aware) and raised throughput to 150/hour. Confirmed working
  (440 → 371 active-swing-signal-on-stale-history rows in 24h) but not fully cleared yet — see
  US History Coverage → Incremental US History Sync.
- OTC permanently excluded from US listings: `scripts/ingest-listings.mjs` now filters OTC out
  of its SEC fetch so a purge of no-history OTC assets stays purged across repeated
  listing-sync runs (re-verified holding at 946 OTC assets, all with real history).
- Help & knowledge base: guided site walkthrough plus 7 statically generated, code-accurate
  articles covering the swing engine, each of the 5 legendary strategies, and the probability
  method (see Help & Knowledge Base section above).
- US OHLCV bulk backfill (4,447 → 8,483 assets with history at the time; 8,543 now).
- Email digest resilience: same-day bounded retry on failure, DB-seeded startup catch-up for a
  missed send window, `"partial"` responses now treated as failure.
- Multi-provider AI model selection (Anthropic / OpenAI / Google) for the NL screener, with a
  provider dropdown, preset-or-custom model picker, and encrypted API key in Settings.
- Email digest with daily morning sends of top 5 Swing Candidates (`runScreener`) and top 5 Probability forecasts (`getProbabilitySummary`) — same engines as the on-screen views.
- Encrypted per-user credentials (AES-256-GCM) for SMTP password and AI API keys, managed in Settings.
- Opt-in email preferences in Settings with configurable send time.
- Nodemailer SMTP integration for any email provider.
- Cron scheduling support (external services, Vercel, or local — in-app wrapper scheduler is primary).
- Natural Language Query feature for screener:
  - Multi-provider structured output (Anthropic native / OpenAI JSON mode / Google Gemini JSON).
  - Three-layer validation (Zod schema → validateFilter → sanitizeIntent) applied identically regardless of provider.
  - One-turn repair loop for parse failures.
  - 30 comprehensive tests covering all sanitization edge cases.
  - Prompt caching on system rules for performance (Anthropic path).
- Startup robustness improvements: retry harness, graceful degradation, sync orchestration.
- CAS statement import validation fixes.
- Fund mapping schema and UI.
- Data Health dashboard and status badges.
- Bhavcopy startup automation.
- TradingView-style charting with `lightweight-charts`.
- 15-minute market-hours NSE/BSE quote refresh.

Uncommitted at the time of this snapshot: only this STATUS.md/CAPABILITIES.md refresh itself.

## Recommended Build Next

### 0. Email Digest — Scheduling & Ops

The email digest is built, verified end-to-end, and pushed to `origin/main`.
Scheduling is handled **in-app** by the startup wrapper `scripts/run-with-nse-sync.mjs`
(same mechanism as the scan/backfill/quote jobs), so no external scheduler is needed
when the app runs under `npm run start` / `npm run dev`.

1. **Set env vars** (see `docs/EMAIL_SETUP.md` / `docs/SECURE_CREDENTIALS.md`):
   - `CREDENTIAL_ENCRYPTION_KEY` (AES master key — `openssl rand -hex 32`)
   - `CRON_SECRET` — the wrapper sends this as the bearer to the digest endpoint.
   - SMTP is stored per-user in Settings → Secured credentials (env `SMTP_*` optional fallback).
   - Optional: `EMAIL_DIGEST_HOUR_IST` (default 7), `EMAIL_DIGEST_MINUTE_IST` (default 0),
     `EMAIL_DIGEST_CRON_DISABLED=1` to turn it off.

2. **How it fires**: the wrapper's 60-second tick calls `/api/cron/send-email-digest`
   once per day at/after the target IST time, deduped by date. If the app was asleep
   past the target and no digest was sent today, startup catch-up sends it immediately;
   if today was already sent, it waits for tomorrow.

3. **Alternative schedulers** (only if not using the wrapper — e.g. a bare serverless
   deploy): cron-job.org / EasyCron hitting the endpoint, or a `vercel.json` crons entry.

4. **Monitor**:
   - Enabled users: `select * from public.email_preferences where enabled = true;`
   - Send logs: `select * from public.cron_logs where job = 'send-email-digest' order by created_at desc;`

### 1. NL Query Feature — provider selection DONE, polish remains

The Natural Language Query feature for the stock screener is built and now multi-provider:

- ✅ `NlQueryBar.tsx` component rendering in StockScreener
- ✅ `nlQuery.ts` dispatches to Anthropic / OpenAI / Google based on the user's Settings choice
- ✅ `parseScreenIntent()` server action resolves the active AI config via `getActiveAIConfig()`
- ✅ Settings → AI model: provider dropdown, preset-or-custom model, encrypted API key
- ✅ 30 tests covering sanitization, validation, edge cases (Anthropic-schema path)

Still open:

- No live end-to-end test of the OpenAI and Google dispatch paths against real API keys yet
  (only the Anthropic path has been exercised with a real send).
- Add error recovery UI for edge cases (query too long, sectors/universes not loaded, API errors,
  provider not configured).
- Add usage telemetry/logging if desired.

### 2. Complete Fund Mapping Coverage

Use `/portfolio/fund-mapping` to review and bulk-accept the 7 remaining exact AMFI/ISIN suggestions, then import AMC disclosures for the remaining 10 funds.

Next actions:

- Import missing AMC monthly portfolio disclosures for unmatched funds.
- Use exact ISIN matches where available.
- Manually link ambiguous funds.
- Keep rejected suggestions as signal for parser/matcher cleanup.
- Once mappings improve, verify Fund X-Ray overlap and shared-stock output again.

### 3. Repair Startup Refresh Robustness

Make `scripts/run-with-nse-sync.mjs` and listing/quote ingestors resilient:

- Treat BSE/NSE malformed response as a warning, not a noisy crash.
- Add retry/backoff.
- Add source-specific user agents and redirect handling.
- Persist sync failure details to `cron_logs`.
- Continue remaining jobs even if one source fails.

### 4. US History Coverage — backfill + permanent OTC exclusion DONE (2026-07-24)

The NASDAQ/NYSE backfill queue was drained in one pass on 2026-07-24
(`scripts/local-backfill-worker.mjs`, ~504-day history via `pipelines/us_history_sync.py`).

Result (backfill):

- US assets with OHLCV history: **4,447 → 8,483**.
- Probability-eligible (≥280 bars): **3,742 → 6,956**.
- Quote-without-history: **5,764 → 1,709**.
- Queue final: 4,194 done, 235 failed, 2 skipped. Plain-ticker success rate **96.4%**;
  failures were concentrated entirely in the non-equity long tail (warrants/rights/units).

### OTC exclusion (2026-07-24, made permanent)

After the backfill, the remaining no-history names were dominated by OTC listings that
Tiingo's EOD equity feed does not cover (and that Google Finance can only quote, not provide
bars for). A first purge removed all no-history OTC assets, but was **reverted within hours**
by `scripts/ingest-listings.mjs` — the security-listing refresh job the wrapper runs
recurringly, which upserts the *entire* SEC universe (including OTC) with no awareness that
some tickers had been manually deleted, so it simply re-inserted them as new rows.

The root cause is fixed, not just the symptom:

- `scripts/ingest-listings.mjs` now filters `exchange === "OTC"` out of the US listings it
  fetches from the SEC before upserting — see `EXCLUDED_US_EXCHANGES` in that file. It never
  deletes existing rows (upsert-only), so this does not touch the 946 OTC assets that already
  have real OHLCV history; it only stops OTC tickers from being (re-)created.
- The no-history OTC assets were purged again (1,664 this time — the exact count had drifted
  slightly since the first attempt because the listing job had already re-added some before
  the fix landed): 1,310 had a live quote, 354 had neither. The 946 OTC assets with history
  were left untouched, as before.
- **Verified durable**: re-ran `ingest-listings.mjs` a second time after the purge — OTC count
  stayed at 946 (did not bounce back to 2,610), confirming the fix holds across repeated runs.

Effect on coverage:

- US active stock assets: **10,655 → 8,991**.
- Coverage (with history): **79.8% → 94.6%**.
- Quote-without-history: now 124 NASDAQ + 90 NYSE + 28 OTHER + 17 CBOE — all real-exchange
  warrants/rights/units or non-standard instruments with no equity bars available anywhere.

Deletion was transactional with a pre-commit guard (verified zero OTC-no-history remained and
delete count matched the backup). **Recoverable** from backup tables:

- `public.removed_otc_assets_20260724_v2` (1,664 rows)
- `public.removed_otc_quotes_20260724_v2` (1,310 rows)

(The first attempt's `removed_otc_assets_20260724` / `removed_otc_quotes_20260724` were dropped
— they held different row ids than what's now in the assets table, since the listing job had
re-created that batch before it was purged again.)

Follow-ups (optional):

- Surface "no history yet" clearly in charts/candidate screens for symbols without bars.
- OTC coverage, if ever wanted for the 946+ names, needs a different provider than Tiingo EOD.
- Re-run the backfill periodically to catch newly listed NASDAQ/NYSE names.
- `scripts/backfill-progress.mjs` prints queue + coverage status for future runs.
- Minor, unrelated data-quality nit spotted in passing: ticker `ALUR` (US) exists as two
  separate `assets` rows on `OTC` and `OTHER` — a pre-existing duplicate-listing quirk from
  the listing ingest, not something introduced here. Harmless (just double-fetches the same
  data into two asset ids) but worth a cleanup pass at some point.

### 4b. Incremental US History Sync — fixed the "keeps going stale" bug (2026-07-24)

**Symptom:** Data Health's Coverage Gaps kept showing hundreds of "Swing signal on stale data"
critical rows (e.g. AAPG, ABT, ABLV — all with fresh quotes but 15+ day old OHLCV) even after
the backfill above completed. Investigated and found two separate bugs, not one:

1. **Selection bug (the real blocker).** `pipelines/us_history_sync.py`'s recurring mode
   (`load_assets()`, no `--symbols`) filtered candidates with `WHERE bar_count < min_bars`
   (260). Any ticker that ever crossed 260 bars was **excluded from every future run,
   permanently** — no matter how stale its latest bar got. AAPG (366 bars), ABT (776 bars),
   etc. could never be selected again by this job, regardless of throughput or frequency.
2. **Throughput bug.** The wrapper's recurring call (`runUSHistory` in
   `scripts/run-with-nse-sync.mjs`) capped this job at `US_HISTORY_LIMIT=50` symbols per
   hourly cycle. With ~8,500 US symbols needing a refresh, 50/hour meant each symbol's turn
   came back around only every ~7 days — nowhere near the 3-day staleness threshold Data
   Health checks against.

Both fixed together (fixing only one would not have solved the symptom):

- **`pipelines/us_history_sync.py`**: added `--stale-days` (default 3, matching
  `lib/dataHealth.ts`'s `historyGap > 3`). The WHERE clause now selects a ticker if it's
  under `min_bars` **or** its latest bar is older than `stale_days` **or** it has never been
  fetched — so already-covered symbols are refreshed, not just under-covered ones.
- Re-ordered the query: `order by last_date nulls last, bar_count, ticker` — oldest-data-first
  drives selection (not lowest-bar-count-first), so a covered-but-15-days-stale ticker is
  prioritized over a fully fresh one. `nulls last` (not first) is deliberate: most never-fetched
  tickers are delisted/no-data junk (verified live — a batch of 20 zero-bar tickers returned
  0/20 fetchable) that would otherwise monopolize every run forever and starve the real,
  covered-but-stale backlog this fix exists to reach.
- **`scripts/run-with-nse-sync.mjs`**: raised `US_HISTORY_LIMIT` default from 50 to **150**.
  This job uses free/unofficial Yahoo Finance (`yfinance`), NOT Tiingo — the paid, real-free-
  tier-limited module (`lib/ingest/usHistory.ts`) is unused by this recurring path. 150/hour
  was chosen empirically: verified via live runs to complete in ~90-120 seconds (leaving ~58
  minutes of the hourly cycle idle), comfortably under the sustained ~28/min rate the same
  script ran at during today's backfill, with zero request failures observed.

Verified with live runs against the real database (not just unit-level): a 150-symbol batch
after the fix correctly surfaced genuinely stale, already-covered tickers (bar_count 1-776,
last_date up to 15+ days old) instead of dead zero-bar junk, fetched 143/150 successfully, 0
failures, in 87.55s. Checked the actual queue position improvement: assets at `ABT`'s coverage
level (776 bars) now have **~1,099 assets ahead of them** (~7 hours to reach) versus **~8,963**
(~60 hours) under the old bar-count-first ordering. The full backlog of 4,515 stale-by-3-days
US assets clears in roughly a day at the new throughput, then holds steady state.

Follow-up: no automated test coverage for `us_history_sync.py` (no Python test suite exists in
this repo); verification was live-database runs. `tsc`/`eslint`/`npm test` all pass for the
`.mjs` wrapper change.

**24-hour check-in (2026-07-25):** the fix is working but slower than the "~a day" estimate —
active-swing-signal-on-stale-history rows dropped from 440 to **371** (US assets >3 days stale
went from ~4,403 to 3,710 of 8,543), a real but partial reduction. The gap between predicted and
actual pace is most likely intermittent app uptime: the dev server was stopped and restarted
multiple times over the day for other testing, so the hourly recurring job did not run
continuously. Under continuous uptime the backlog should keep clearing at ~150/hour; no further
code change indicated yet — this needs another observation window before concluding otherwise.

> ⚠️ **That conclusion was wrong.** The slow pace was not intermittent uptime — the ordering
> introduced here had a latent starvation bug that stopped progress entirely once the queue
> head filled with dead tickers. See 4c below. Recorded rather than rewritten, because the
> mistake was diagnostic: a partial improvement was read as "working, just slow", and the
> proposed next step was to wait and observe rather than to re-examine the mechanism.

### 4c. Incremental US History Sync — fixed the starvation regression (2026-08-02)

**Symptom:** US OHLCV coverage had collapsed to **53 of 8,703 assets fresh** (from ~4,000 on
2026-07-24), with 8,513 sitting 8–30 days stale. The job itself looked healthy: it had run 87
consecutive hourly cycles with zero errors. But every run emitted *byte-identical* output —
`stocks=150 fetched=144 bars_written=257 no_data=6 failed=0` — i.e. it was reprocessing the
same 150 symbols forever and never advancing.

**Root cause — a regression introduced by 4b's own fix.** Ordering the batch by `last_date`
(data staleness) silently assumes that fetching a symbol advances its `last_date`. That does
not hold for delisted/dead tickers: Yahoo returns nothing new, `last_date` never moves, so they
remain the most-stale rows and win the `ORDER BY` again on the next run, and the next,
indefinitely. About 150 dead tickers (`AKPPS`, last traded 2023-12-04; `ADZCF`; `CBRGF`; mostly
1-bar warrants) monopolised every run while ~8,500 healthy symbols were never selected at all.

This is the *same* head-of-line blocking 4b explicitly anticipated for never-fetched symbols and
guarded against with `nulls last`. What was missed: a symbol that *has* a `last_date` can be
permanently stuck in exactly the same way. 4b's verification passed because it only checked a
single batch's composition — one run cannot reveal a loop.

**Fix — order by attempt time, never by data staleness.** Attempting a symbol now always
rotates it to the back of the queue, whether or not it returned bars. Starvation becomes
*structurally impossible* rather than merely unlikely, which is the property 4b lacked:

- **`db/migrations/0024_us_history_sync_state.sql`**: new `us_history_sync_state` table
  following the existing `quote_sync_state` / `fundamentals_sync_state` convention —
  `(asset_id, provider)` key, `last_attempt_at`, `last_success_at`, `consecutive_empty`,
  `last_error`.
- **`pipelines/us_history_sync.py`**: `record_attempt()` stamps *every* attempt — success,
  empty, and error alike — wrapped so bookkeeping failure can never abort the sync; dry runs
  deliberately do not mutate rotation state. Selection now orders by
  `last_attempt_at nulls first` (new listings picked up promptly) and backs off
  repeatedly-empty symbols by `consecutive_empty` days, capped at 14 — dead tickers consume
  progressively fewer slots but are never abandoned, so one that resumes trading is retried
  within a fortnight at worst.

**Verified against the live database over multiple cycles** (not a single batch, which is
precisely what let 4b's bug through):

- Three consecutive runs processed three *disjoint* symbol sets (`A/AA/AAAU…` →
  `AACG/AACI/AACIU…` → `AACPR/AACPU/AACPW…`), where previously they were identical.
- Two production-size runs wrote **1,671** and **1,715** bars, against the stuck loop's
  constant 257.
- Backoff exercised across the matrix: 0 empties always eligible; 5 empties excluded at 2 days
  and eligible at 6; 30 empties (capped to 14) excluded at 10 days and eligible at 15 —
  confirming nothing is permanently abandoned.
- 8,766 candidates eligible; at 150/hour the universe cycles in **~2.4 days**, inside the
  3-day staleness threshold Data Health checks against.

**Expected drain:** the backlog needs ~2.4 days of continuous uptime to clear, so Data Health
will keep showing elevated US staleness until roughly **2026-08-05**. That is drain time, not a
stall — worth a spot-check then to confirm the fresh count is actually climbing rather than
flat.

Follow-up: still no Python test suite in this repo, so `us_history_sync.py` has no automated
regression test. Given this file has now had two ordering bugs in nine days, a small pytest
around `load_assets()`'s selection/rotation would be the highest-value next addition.

### 5. Help Knowledge Base — done, could extend

`/help` and its 7 articles (see Help & Knowledge Base section above) are shipped and verified.
If extended further:

- A search box across articles once the count grows past what a single index page can show.
- Per-market worked examples (an IN and a US ticker walked through each strategy's exact numbers).
- Move content to a lightweight CMS/MDX if non-engineers need to edit copy without a code change.

### 6. Commercial Navigation Pass

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

### 7. Strategy Validation Layer

Before public launch, every strategy should expose:

- Current signal.
- Why it fired.
- Data freshness.
- Historical hit rate.
- Forward-test status.
- Average gain/loss.
- Drawdown.
- False-positive count.

### 8. Production Readiness

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
