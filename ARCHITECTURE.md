# InvestoGenie Architecture

_Living architecture reference. Last updated: 2026-09-22 at product revision `9f77b09`._

## System Overview

InvestoGenie is a server-authoritative market terminal for Indian and US equities. The active
production system runs on AWS Lightsail. A Next.js application serves the web UI, versioned mobile
APIs, authentication and server actions; PostgreSQL is the system of record; Node and Python jobs
maintain market, broker, news, fund and portfolio data.

```text
Market/news/broker sources
  |-- NSE/BSE Bhavcopy, Yahoo, Google, FRED
  |-- ICICI Breeze
  |-- GNews, Marketaux, NewsAPI, Alpha Vantage
  |-- AMFI, AMC disclosures, Gmail CAS/disclosures
  v
Schedulers and ingestion workers
  v
PostgreSQL
  ^
  |-- Next.js server actions and web routes
  |-- /api/v1/mobile/*
  v
Web terminal                    Android / iOS client
```

Trading calculations and ranking remain on the server. The web and mobile clients display the
same server-produced Strong Swing, News & AI and Trade Ledger results. Mobile refreshes do not
recalculate, reorder or reinterpret candidates.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Web and API | Next.js 16.3.4 App Router, React 19, TypeScript |
| Mobile | Expo SDK 57, React Native 0.86, TypeScript |
| Database | PostgreSQL through `pg` / node-postgres |
| Styling | Tailwind CSS 4 and CSS custom properties |
| Charts | Lightweight Charts on web; native SVG OHLC candles on mobile |
| Authentication | Signed HTTP-only web sessions; hashed, expiring bearer tokens for mobile |
| Credentials | AES-256-GCM encrypted per-user provider credentials |
| Background work | Node scheduler plus Python ingestion and Breeze workers |
| Production | AWS Lightsail, systemd, Nginx/HTTPS, local PostgreSQL |
| Local fallback | macOS `launchd` and private Tailscale Serve HTTPS |

## Repository Boundaries

```text
app/                    Next.js pages, route handlers and server actions
components/             Web presentation components
lib/analytics/          Pure signal, ranking, risk and strategy calculations
lib/news/               News providers, deduplication, evidence and classification
lib/cas/                CAS parsing and import
lib/funds/              AMFI/snapshot identity and fund mapping
lib/breeze/             Breeze session, broker safety and reconciliation
lib/backfill/           Persistent OHLCV repair queue
lib/mobile*.ts          Mobile auth, mutations and alert delivery
pipelines/              Python market/fundamental/history synchronization
workers/                Breeze market, OI and account workers
scripts/                Scheduler, sync, migration and deployment utilities
db/migrations/          Ordered PostgreSQL schema migrations
mobile/                 Isolated Android/iOS React Native client
deploy/                 AWS-compatible Linux, Oracle and local Mac operations
```

## Web Application Surfaces

The market workspace is parameterized by `in` or `us`:

- `/terminal/[market]`: terminal overview.
- `/terminal/[market]/stocks`: stock screener.
- `/terminal/[market]/screener`: filter/NL screener workspace.
- `/terminal/[market]/strong-swing`: execution-gated Strong Swing candidates.
- `/terminal/[market]/news-swing`: Strong Swing candidates with bounded news intelligence.
- `/terminal/[market]/trade-ledger`: open and closed swing trades, partial exits and P&L.
- `/terminal/[market]/long-term`: long-horizon fundamentals candidates.
- `/terminal/[market]/probability`: 21-session probability projections.
- `/terminal/[market]/forward-test`: out-of-sample signal tracking.
- `/portfolio/fund-mapping`: CAS holding to AMC snapshot mapping and overlap.
- `/terminal/in/cas`: CAS import.
- `/data/health` and `/admin/sync`: freshness, gaps, jobs and repair operations.
- `/settings`: risk, AI/news, email, Gmail and ICICI Breeze credentials.

Server components load authenticated data directly. Client components handle filtering,
interaction and refresh without owning the financial calculations.

## Calculation Boundary

The protected calculation layer includes:

- `lib/analytics/swingClassifier.ts`: technical setup classification and raw setup fields.
- `lib/analytics/legendaryStrategies.ts`: Qullamaggie, Minervini, Darvas, PTJ and Simons rules.
- `lib/analytics/strongSwing.ts` and `lib/strongSwing.ts`: execution and confirmation gates.
- `lib/analytics/candidateRanking.ts`: deterministic candidate ordering.
- `lib/analytics/tradeRisk.ts`: market/execution risk checks.
- `lib/swingTradeProjection.ts`: shared projection resolution used by web and mobile ledger flows.
- `lib/swingTradeLedger.ts`: frozen plans, current state and P&L.
- `lib/newsSwing.ts` and `lib/analytics/newsSwing.ts`: bounded news overlay.

The calculation flow is:

```text
OHLCV + latest quote + fundamentals/context
  -> swing classifier and strategy detectors
  -> persisted swing_signals
  -> user risk settings applied at read time
  -> Strong Swing confirmation/execution gates
  -> deterministic candidate ranking
  -> optional News & AI overlay (cannot create a technical setup)
  -> ledger freezes the selected entry plan at purchase
```

Targets, stops, trail and holding windows are projections, not guarantees. Ledger records retain
the plan that existed at purchase so later strategy changes cannot silently rewrite a live trade.
Phase 1-4 mobile work did not modify these formulas or ranking rules.

## News Intelligence

`lib/news/providers.ts` queries configured providers independently and merges successful results.
Provider failure is isolated so one unavailable API does not erase the other providers' evidence.
Watermarks fetch only newer articles; canonicalization and similarity rules remove duplicates.

Priority is:

1. Open Trade Ledger symbols.
2. Current Strong Swing candidates.
3. Ordinary Swing candidates for broader context.

Structured classification may use the user's selected Anthropic, OpenAI, Google or DeepSeek
provider. Evidence quality, source trust, stock specificity, age and corroboration constrain the
result. Broad macro stories can add caution but cannot independently force a stock-specific exit.
Only verified severe stock-specific evidence can activate the News & AI risk-off veto.

## Trade Ledger

Migration `0030_swing_trade_ledger.sql` introduced the ledger, migration
`0034_swing_trade_partial_exits.sql` added partial exits, and migration
`0046_trade_ledger_returns.sql` added broker-reconciled acquisition, sale and realized-P&L values.
The ledger supports:

- Logging a purchase from an existing server signal or manually supplied symbol, date, price and
  quantity while resolving the remaining plan from stored signal data.
- Editing and deleting an entry.
- Partial and final sales, plus correction of recorded sales.
- Open, realized and overall P&L, cumulative trade turnover, capital-employed ROI and XIRR.
- Five-minute current-price refresh during market hours.
- Hourly stock-first News & AI assessment during the relevant trading session.
- Read-only ICICI Breeze holdings, positions and order reconciliation for InvestoGenie-era trades.

Broker reconciliation does not alter orders or ledger rows automatically. Older long-term broker
holdings are excluded from the InvestoGenie swing-trade reconciliation scope.

Portfolio return accounting is cash-ledger based. Purchases consume retained cash, sales replenish
it, and only a dated shortfall is treated as external capital. ROI divides overall P&L by those
inferred contributions. XIRR uses the dated contributions and terminal retained cash plus current
open-position value. This prevents repeatedly circulated sale proceeds from inflating the capital
denominator. Per-trade returns continue to use that trade's broker-reconciled cash flows.

## Mobile Architecture

`mobile/` is an isolated client. It uses these versioned endpoints:

- `/api/v1/mobile/auth/login` and `/auth/logout`.
- `/api/v1/mobile/me`.
- `/api/v1/mobile/strong-swing`.
- `/api/v1/mobile/news-swing`.
- `/api/v1/mobile/trade-ledger` and nested trade/sale mutation routes.
- `/api/v1/mobile/assets/search` and `/candles`.
- `/api/v1/mobile/push-token`.

Authentication creates a random 256-bit token. SecureStore holds the raw token on-device;
PostgreSQL stores only its SHA-256 hash. Tokens expire after 30 days and can be revoked. Biometric
authentication protects restored sessions after backgrounding.

The client provides India/US selection and visible `Strong`, `News & AI`, and `Ledger` workspaces.
Version `0.1.1` / Android `versionCode` 2 / iOS build 2 includes the safe-area navigation fix.
The first installed Android APK predates this fix and must be replaced by a new local build.

### Mobile build and distribution

Expo SDK packages remain open-source runtime dependencies, but Expo cloud build/update services
are not the approved distribution path. Native projects and binaries will be generated locally:

```text
mobile source -> expo prebuild -> Gradle/Android Studio -> signed APK/AAB
                              -> Xcode/CocoaPods       -> signed iOS app
```

No EAS Build, Expo Updates or cloud source upload is required. The Mac still needs full Xcode,
CocoaPods and Apple signing configured before the first local iOS build. Free Apple-ID development
signing can install on the owner's device with periodic re-signing; TestFlight/App Store delivery
requires Apple Developer Program membership.

Push payloads are deliberately generic and contain no ticker, price, recommendation or financial
detail. The authenticated client fetches current ledger state after opening. Delivery currently
uses the Expo push relay; direct FCM/APNs is the future transport-hardening step.

## Market Data and Scheduling

`npm start` runs `scripts/run-with-nse-sync.mjs`, which supervises Next.js and recurring jobs in the
same systemd service on AWS. Important schedules include:

- India/US market-hours quote refresh, default every five minutes.
- Breeze market worker and five-minute read-only account reconciliation when credentials/session
  are valid.
- Hourly News & AI refresh during the India and US trading sessions.
- Five-minute mobile ledger alert evaluation during market hours.
- India end-of-day Bhavcopy with bounded publication-delay retries.
- US quote, OHLCV and fundamentals updates.
- Daily macro, AMFI scheme-master, Gmail disclosure, email digest and signal jobs.
- Persistent OHLCV backfill queue after the configured India/US sessions.

Market-calendar helpers distinguish trading sessions, weekends and configured exchange holidays.
Health logic compares data to the latest expected completed session instead of wall-clock age, so
a valid Friday close is not marked stale on a weekend or exchange holiday.

### Provider authority and fallback

- India live priority set: ICICI Breeze when connected; Yahoo/Google and exchange sources remain
  fallbacks.
- India end-of-day authority: NSE/BSE Bhavcopy.
- US quotes/history: Yahoo-based pipelines with Google fallback where supported.
- Macro: FRED-backed pipeline.
- All writes carry timestamps/source metadata; stale or unavailable assets are excluded from
  candidate calculations until repaired or intentionally retired.

## Portfolio, CAS and Fund Look-through

The fund flow is:

```text
CAS PDF or Gmail attachment
  -> CAS parser
  -> user_mutual_fund_holdings keyed by user + ISIN + folio
  -> AMFI identifier resolution / user_fund_mappings
  -> fund_schemes + fund_holdings_snapshot
  -> stock-level fund composition and pairwise overlap
```

The parser preserves multiple schemes in one folio, the same ISIN in different folios, child-holder
names inside a consolidated statement and current scheme names. Rejected records are auditable;
resolved errors from older CAS imports are retired when a newer successful statement supersedes
them. Gmail import limits CAS processing to the latest relevant statement and separately discovers
monthly AMC disclosures.

Mappings are explicit in `user_fund_mappings`, not inferred on every X-Ray request. Exact ISIN
matches can be accepted automatically when unambiguous; name-only matches require confirmation.
Fund valuation comes from current CAS holdings, while stock composition and overlap come from the
latest mapped AMC snapshots.

## Database Domains

The schema is migration-driven. Main domains are:

| Domain | Principal objects |
| --- | --- |
| Identity/auth | `users`, web sessions, password-reset tokens, `mobile_sessions` |
| Market reference | `assets`, listings/identifiers, exclusions |
| Prices | `latest_quotes`, `daily_ohlcv`, source/sync state |
| Signals | `swing_signals`, Strong Swing snapshots, forward-test records |
| Fundamentals/macro | financial reports, normalized statements, macro indicators |
| Portfolio | portfolios, holdings, transactions, watchlists |
| Ledger | swing trades and partial exits |
| Funds | CAS holdings/rejections, AMFI master, fund schemes/snapshots/mappings |
| News | articles, analyses, stock impacts, providers/source trust |
| Credentials | encrypted user provider, Gmail, SMTP and Breeze credentials |
| Broker | Breeze holdings/positions/orders snapshots and execution-safety metadata |
| Operations | `cron_logs`, backfill queue, tracking exclusions, sync alerts |
| Mobile | hashed sessions, push devices and notification audit/deduplication |

All user-owned queries are scoped by `user_id`. `lib/db.ts` owns the shared PostgreSQL pool and the
application follows the existing parameterized-query pattern.

## Authentication and Secrets

Web login writes a signed, HTTP-only session cookie. Mobile uses bearer tokens as described above.
Cron routes require `CRON_SECRET`; an unset secret is treated as configuration failure, never as an
open endpoint. User-entered API credentials are encrypted before persistence and can be managed in
Settings, avoiding ordinary provider keys in client bundles.

OAuth integrations use server-side callbacks for Gmail and Breeze. The user's Google or ICICI
password/OTP is handled by the provider and does not pass through InvestoGenie.

## Deployment

### AWS production

- AWS Lightsail is the active production host.
- `investogenie.service` runs `npm start` from `/opt/investogenie/app` with an external environment
  file and restarts the web server/scheduler together.
- Nginx terminates HTTPS and proxies to the localhost Next.js listener.
- PostgreSQL is local to the instance and is not exposed publicly.
- Release procedure: fetch the intended `main` revision, install locked dependencies, run
  migrations/tests/build, then restart and inspect systemd logs.
- Product revision `9f77b09` is deployed and `main` is aligned with `origin/main`.

### Local fallback

`deploy/local/` retains the macOS `launchd` and Tailscale Serve setup for development and private
fallback access. `deploy/oracle/` remains an alternate Linux deployment package, not an active OCI
environment.

## Verification and Change Safety

The normal verification gates are:

```bash
npm run lint
npm test
npm run build
cd mobile && npm run typecheck && npm run validate:release
```

Phase 4 passed 228 Vitest tests, lint, mobile typecheck, release validation and the Next production
build. When mobile/platform work is requested without a strategy change, diffs must remain empty
for the protected calculation and ranking modules listed under Calculation Boundary.

## Current Architectural Gaps

- The web server and scheduler share one systemd service/process tree; heavy ingestion can still
  contend with interactive requests. Separate worker services are the durable next step.
- The replacement Android APK has not yet been built locally from `5b1bd0b`.
- Local iOS build is blocked on Xcode, CocoaPods, simulator/runtime and Apple signing setup.
- Push delivery still depends on Expo's relay; direct FCM/APNs would remove that external hop.
- Some long-term normalized statement coverage and fund snapshot coverage remain incomplete.
- Market/provider limits and unsupported symbols require ongoing exclusion/backfill maintenance.
- Probability weights and some investor-strategy proxies remain disclosed heuristics pending
  outcome calibration and broader historical validation.
