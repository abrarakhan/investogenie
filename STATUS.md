# InvestoGenie Status

_Last updated: 2026-07-24 (Help knowledge base shipped; OTC purge reverted by listing sync -- see note; digest resilience; multi-provider AI)_

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
- Help & knowledge base: `/help` (guided walkthrough + article index), `/help/[slug]` (7 articles)
- About page: `/about`
- Login: `/login`

### Terminal Workspaces

- India terminal: `/terminal/in`
- US terminal: `/terminal/us`
- New market workspace route family: `/app/[market]`
- Market overview route: `/markets/[market]`
- Stocks route: `/terminal/[market]/stocks`
- Screener route: `/terminal/[market]/screener` (with NL query support)
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
- `0020_email_preferences.sql`: user email digest opt-in settings (send time, screen toggles, last sent timestamp).
- `0021_user_credentials.sql`: per-user encrypted credentials (SMTP password, AI API keys) via AES-256-GCM.
- `0022_ai_provider_config.sql`: active AI provider/model/key selection for the NL screener (Anthropic/OpenAI/Google).

## Current Local Data Coverage

Latest local Postgres snapshot checked on 2026-07-24:

| Area | Count / Status |
|---|---:|
| Assets (all classes/markets) | 18,286 |
| Latest quotes | 17,432 |
| OHLCV bars | 7,644,812 |
| Swing signals | 10,765 |
| Financial report rows | 123,450 |
| Macro indicator rows | 8,192 |
| Cron log rows | 401 |
| US active stock assets | 10,655 (the 2026-07-24 OTC purge was undone by the next security-listing sync — see US History Coverage → OTC purge) |
| US assets with OHLCV history | 8,505 / 10,655 (79.8%) |
| India active stock assets | 7,563 |
| India assets with OHLCV history | 7,284 / 7,563 (96.3%) |
| US fundamentals coverage | 5,158 assets with a latest financial report |
| India fundamentals coverage | 6,507 assets with a latest financial report |
| US swing scan: scanned / buy candidates | 7,819 / 1,030 |
| India swing scan: scanned / buy candidates | 2,946 / 450 |

Portfolio/fund figures below are from the 2026-07-22 snapshot and have not been re-measured since:

| Area | Count / Status |
|---|---:|
| Fund schemes with snapshots | 12 |
| Fund snapshot rows | 936 |
| Explicit user fund mappings | 6 |
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
- Security listing refresh.
- Quote refresh.
- US quote/fundamental/history sync hooks.
- Macro sync hook.
- Signal scan trigger through cron API.
- Queued OHLCV repair trigger through a detached local worker script.
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

- US OHLCV coverage sits at 79.8% of active stocks (10,655 total, 8,505 with history).
  The 2026-07-24 backfill and OTC purge pushed this to 94.3%, but the recurring
  security-listing sync re-added the purged OTC tickers the same day (see US History
  Coverage → OTC purge). India coverage is strong at 96.3% (7,563 total, 7,284 with history).
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

- 113,129 financial report rows are present.

Current limitations:

- NL query feature awaiting final integration into StockScreener UI and API wiring.
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
- Migrations `0020_email_preferences.sql`, `0021_user_credentials.sql`.

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

- 8,161 macro indicator rows are present.

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

Recent checks after NL Query feature and startup robustness:

- `npm test`: passing, 76/76 tests (including 30 new NL query validation tests).
- `npx tsc --noEmit`: passing, no type errors.
- `npm run build`: passing cleanly under Turbopack with all routes recognized.
- `npm run lint`: 4 pre-existing errors in unrelated files (backfill/refresh/scan/syncJobWrapper/syncMonitor).

Recent verified command set on 2026-07-23:

- `node --check scripts/run-with-nse-sync.mjs`: passing.
- `node --check scripts/local-backfill-worker.mjs`: passing.
- `npx tsc --noEmit`: passing, no errors.
- `npm test`: passing, 76 tests.
- `npm run build`: passing with all routes generated.

## Git State At Time Of This File

Current branch:

- `main`

Recent commits:

- `9608c77 Expand Help into a professional blog-style knowledge base`
- `69774c4 STATUS.md: soften stale US OHLCV coverage limitation`
- `7038a78 STATUS.md: record US OTC purge (1,721 no-history assets removed)`
- `cf6dc8f US OHLCV bulk backfill complete (2026-07-24)`
- `18ca155 Update STATUS.md: digest scheduling resilience`
- `f37ae84 Make the email digest survive a failed or missed send window`
- `cdcc449 Fix email digest to use the real Swing & Probability data sources`
- `1f1be30 Add encrypted credentials storage for SMTP and AI API keys`
- `ef3c80d Add daily email digest feature with swing candidates and probability picks`

(Pushed to `origin/main`.)

Committed app work now includes:

- Help & knowledge base: guided site walkthrough plus 7 statically generated, code-accurate
  articles covering the swing engine, each of the 5 legendary strategies, and the probability
  method (see Help & Knowledge Base section above).
- US OHLCV bulk backfill (4,447 → 8,483 assets with history) and an OTC purge experiment —
  note the purge did not persist against the recurring security-listing sync (see US History
  Coverage → OTC purge for the full account and unresolved follow-up).
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

Uncommitted non-app files:

- `.claude/context/decisions_history/` (tracking session decisions)
- Decision notes from previous sessions

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
   once per day at/after the target IST time, deduped by date. A restart past the
   send time waits until the next day (no out-of-schedule send).

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

Use the new `/portfolio/fund-mapping` screen to move Fund X-Ray from 6/21 matched funds toward full coverage.

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

### 4. US History Coverage — backfill DONE, OTC purge reverted (2026-07-24)

The NASDAQ/NYSE backfill queue was drained in one pass on 2026-07-24
(`scripts/local-backfill-worker.mjs`, ~504-day history via `pipelines/us_history_sync.py`).

Result (backfill):

- US assets with OHLCV history: **4,447 → 8,483**.
- Probability-eligible (≥280 bars): **3,742 → 6,956**.
- Quote-without-history: **5,764 → 1,709**.
- Queue final: 4,194 done, 235 failed, 2 skipped. Plain-ticker success rate **96.4%**;
  failures were concentrated entirely in the non-equity long tail (warrants/rights/units).

### OTC purge (2026-07-24)

After the backfill, the remaining no-history names were dominated by OTC listings that
Tiingo's EOD equity feed does not cover (and that Google Finance can only quote, not
provide bars for). All **1,721 US OTC assets with no OHLCV history** were removed
(1,428 had a live quote, 293 had neither). The 946 OTC assets that *do* have history
were left untouched.

Effect on coverage:

- US active stock assets: **10,712 → 8,991**.
- Coverage (with history): **79.2% → 94.3%**.
- Quote-without-history: **1,709 → 281** (now all real-exchange: 235 NASDAQ/NYSE
  warrants/rights/units + 46 OTHER/CBOE — no equity bars available anywhere).

Deletion was transactional with a pre-commit guard (verified zero OTC-no-history
remained and delete count matched the backup). **Recoverable** from backup tables:

- `public.removed_otc_assets_20260724` (1,721 rows)
- `public.removed_otc_quotes_20260724` (1,428 rows)

**⚠️ Purge did not stick — re-verified same day.** The wrapper's recurring security-listing
refresh re-inserts tickers from the upstream security master on its normal cadence, and it has
no awareness of the manual deletion — it just upserts the OTC listing again as a new row (new
`id`, `created_at`). By later on 2026-07-24, ~1,664 OTC no-history assets were back and US
coverage was measured at **10,655 total / 8,505 with history (79.8%)** — essentially back to
pre-purge. The backup tables above are stale relative to the current OTC rows (different ids)
and are kept only as a record of what the first purge removed.

To make an OTC purge stick, either:

- Exclude `exchange = 'OTC'` in the security-listing refresh job so it stops re-adding them, or
- Re-run the same delete periodically (accepting it is a recurring cleanup, not one-time), or
- Mark purged OTC tickers `is_active = false` instead of deleting, and have listing refresh
  respect that flag on conflict instead of reactivating them.

None of these have been implemented — this is flagged as a follow-up, not done.

Follow-ups (optional):

- Decide and implement one of the three options above if a permanent OTC exclusion is wanted.
- Surface "no history yet" clearly in charts/candidate screens for symbols without bars.
- OTC coverage, if ever wanted, needs a different provider than Tiingo EOD.
- Re-run the backfill periodically to catch newly listed NASDAQ/NYSE names.
- `scripts/backfill-progress.mjs` prints queue + coverage status for future runs.

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
