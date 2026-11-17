# InvestoGenie Status

_Code and production baseline reviewed 14 November 2026 through deployed revision `f33f256` on main._

This is a repository status reference. The production web/Breeze services, HTTPS login endpoint, schema through 0077, India results coverage and India Armed volume curve were checked at revision `f33f256`; broker account contents and installed mobile binaries were not inspected. The checks below are a dated baseline, not a guarantee of continuing provider or market-data health.

## Implemented in the reviewed source

- Next.js 16.4.2 / React 19.2.4 web application with India/US terminal routes.
- Fundamental/price-action Stock Screener, natural-language filtering, saved screens and exports.
- Swing, Strong Swing, legacy/V2 Momentum Ignition, News & AI, Long-Term and Probability research surfaces.
- Trading strategy calculations are Python-authoritative: Base Swing, named strategies, Strong Swing, Momentum, Trend Continuation, Armed Swing, News overlays and ledger projections. Strong Swing, Momentum and Armed Swing TypeScript engines have been removed; their TypeScript modules are contracts only. Remaining legacy ledger formulas are migration-test debt, not production authorities.
- Armed Strong Swing at `/terminal/[market]/armed-swing`, separate from the existing Strong Swing gates/rankings.
- Immutable Armed and protected execution plans, with server-side ownership/session/status/price validation.
- Ledger pending buy-stops, partial fills, remaining-quantity tracking and cancellation.
- Broker-reconciled cash flows, retained-proceeds capital employed, ROI and XIRR.
- Cost-aware Adaptive Allocation backtests and separately enabled capped Breeze buy-only automation.
- CAS/AMFI fund mapping, AMC disclosures, fund overlap and optional Gmail auto-import.
- Gmail revoked-grant detection and connection error/reconnect state.
- Server-authoritative Expo mobile client with ledger mutations, News & AI, candles, biometrics and deduplicated alerts.
- Completed-session Momentum bases with separately verified live-session quote/OHLCV input, session-aware freshness and explicit execution blocking when evidence is absent.
- Account-wide candidate observation scans independent of push-token enrollment, persisted status transitions and two-minute Breeze live-target reconciliation.
- Python ML snapshot/feature/label foundation with golden-vector tests; no complete model training/inference runtime.

## Latest schema additions

| Migration | Purpose |
| --- | --- |
| 0051 | ML advisory foundation |
| 0052 | Corporate results calendar and sync state |
| 0053 | Immutable Armed Swing plans |
| 0054 | Pending buy-stop orders and fill audit |
| 0055 | Protected Strong Swing/Momentum execution plans |
| 0056 | Authoritative results-calendar coverage window |
| 0057 | Gmail last-error timestamps and reconnect flag |
| 0058 | Persisted daily screener technical features and forward outcomes |
| 0059 | Candidate signal observation history |
| 0060–0068 | Trend continuation, browser-notification deduplication, signal ranking and retrospective evaluation |
| 0069–0071 | User roles, invitations and canonical system owner |
| 0072–0076 | Breeze history, quote order flow, intraday bars and broker order audit/actions |
| 0077 | Versioned market-specific intraday volume curves |
| 0078 | Point-in-time Strong Swing benchmark identity |
| 0079 | Email-digest and mobile-mutation idempotency |
| 0080 | Point-in-time one-session change for screener backtests |
| 0081 | Historical fundamental screener metrics and point-in-time shareholding filings |

The shared Linux release script discovers and applies migrations from 0033 onward in filename order. Fresh databases still need the full ordered schema. `scripts/verify-production-schema.mjs` checks required relations, including candidate observations, trend-continuation signals, browser-notification events, broker-order audits and market-volume curves. Browser notification signatures are unique per user and market day, and polling is serialized across open tabs. Trade-alert identity uses stable decision state rather than changing quote explanation text. After pulling, the release script re-executes the checked-out version once so a migration added in the same release is applied.

Authenticated web pages expose an opt-in browser-alert control. While the site is open in a foreground or background tab, it polls deduplicated server events and uses the browser Notification API for candidate-ready transitions and material ledger actions. Permission is requested only from an explicit user click; denied permission is never bypassed.

Trend Continuation v1 is an India-only, Python-calculated engine for persistent 3–5 session moves. It stores versioned impulse/watch/ready/extended states and appears on web and mobile Strong Swing surfaces. Day-one impulses and later pullbacks remain observational. A confirmed day-two breakout after 10:15 IST can create an immutable manual Buy & Track plan only when fresh Breeze depth, spread, circuit room, results-calendar, price-range and plan-freshness gates pass. It never feeds auto-buy.

## Verified production baseline — 17 November 2026

- Revision `784f894` is checked out; web and Breeze services are active and `/login` returns HTTP 200.
- Migrations 0082 (Strong Swing replay tables) and 0083 (near-miss flag) are applied.
- Release validation passed 516 TypeScript tests, 215 pipeline Python tests, typecheck and lint.
- Strong Swing moved to `strong-swing-v8-entry-open`. The stored India replay run
  `1d6fb6e3` reproduces 612 signals at 49.3% and +0.54% per signal, unchanged from v7 —
  the new gate is inert in the `--session open` arm the record is measured on, by design.
- 787,151 one-minute Breeze candles are stored under source `BREEZE_REPLAY` covering the
  replayed signals; the daily intraday sync's retention prune is scoped to exclude them.
  The count drifts down slightly as the daily sync re-sources sessions that overlap its own
  retention window; the bars remain, under `BREEZE_HISTORICAL`.
- The only local uncommitted files were machine-local `.claude/launch.json` and the
  generated block in `CLAUDE.md`; neither was included in the release.

## Strategy and reliability changes — 17 November 2026

- Trend Continuation moved to `trend_continuation_v8_midway`, adding mid-way momentum
  detection for days 2 to 4 of a move: three variants over the existing engine, gated on
  NSE deliverable quantity, a Rs 10 crore ignition bar, intraday volume pace against the
  0077 session curve, and an exhaustion ceiling. Migration 0084 adds
  `daily_delivery_metrics` and the per-signal evidence columns; 0085 completes the
  screener's live volume-pace column.
- Delivery ingestion stores NSE series EQ only and flags ETFs, REITs and InvITs, all of
  which settle at or near 100% delivery by rule or construction and would otherwise read
  as maximum conviction every session.
- These thresholds are a specification rather than a measured edge; no replay has tested
  them. Until delivery has been ingested for a usable history, the mid-way paths qualify
  nothing, which is the intended fail-closed behaviour.

- `entry_open` (v8) holds the session's own opening price to the entry band. One-minute
  paths for 1,295 entries measured days that gapped into the band at +0.40% per trade
  against -0.15% for the 730 that walked in later; the screen previously offered both and
  the per-trade edge was +0.09%. Outside an open session the gate stands aside; a dated
  session with no opening price fails rather than passing silently.
- The gate is not a cure: the gapped-in population still wins only 48.8% of the time, and
  MEESHO on 2026-11-16 opened inside the band at 0.69 ATR and reversed anyway.
- The measured-record note now warns when a stored run predates the deployed model.
- `pipelines/intraday_entry_study.py` normalises each Breeze session onto the adjusted
  `daily_ohlcv` scale before comparing. Its first version did not, and compared 2017 raw
  prices against adjusted ones that differ by a third; that result was discarded.
- A full-session outage of `/terminal/in/strong-swing` was diagnosed: the recurring trend
  scan ran every 120s with a 110s cap it could never meet, holding one of two CPUs
  continuously, and request-path engine batches were killed at 30s in the contention.
  Scan now every 15 minutes with a 600s cap; engine batches capped at 90s.
- The Breeze refresh banner no longer reports a cancelled request as an outage: requests
  carry an AbortController, abort on cleanup and after 60s, and an AbortError is swallowed.

## Verified production baseline — 14 November 2026

- Revision `f33f256` was checked out; web and Breeze services were active and the public HTTPS `/login` returned HTTP 200.
- Migration 0077 was applied and the production schema verifier passed.
- Local release validation passed 573 TypeScript tests, 91 pipeline Python tests, 77 worker Python tests, typecheck, lint and the production build before promotion.
- Active NSE results-calendar verification covered 2,943 of 2,945 assets (99.93%) at the recorded check.
- The active India Armed curve is `in-median-2026-09-16-2026-11-13-40s`, built from 1,425 complete Breeze asset-sessions across 40 eligible sessions. A short special session was rejected by the completeness rule.
- US Armed remains fail-closed: Breeze is India-only and no equivalent US depth/intraday source is configured.
- The only local uncommitted file at deployment was machine-local `.claude/launch.json`; it was not included in the release.

## Strategy review and changes — 13–14 November 2026

The formulas, gates and post-purchase handling of Swing Candidates, Strong Swing and Armed Strong Swing were reviewed at revision `30e6dd4` and the 14 findings were closed in source on 14 November 2026; see [swing strategy rules and review](docs/swing-strategies.md) for each rule and change.

- Strong Swing is model `strong-swing-v8-entry-open`; the rules below describe v4, to which v5 added the `benchmark_data` gate and the `UNVERIFIED` status, v6 added the session hold and intraday-reversal gates, v7 replaced the entry ceiling with a measured 0.25-0.75 ATR band and demoted the v6 session gates to advisory after a controlled replay found they removed four of five signals without improving the win rate, and v8 added `entry_open`, which holds the session's own opening price to that same band after one-minute paths for 1,295 entries measured days that gapped into the band at +0.40% per trade against -0.15% for the 730 that walked in later: breakout quality is judged on the bar that broke out, stocks holding a two-close breakout are assessed even when the base scan lists no setup, the trend needs the 50-day above the 200-day, a live price below the entry waits, and India entries need a verified results calendar with no results within three sessions. Plans and captures from v3 are refused at purchase and by auto-buy.
- Legendary tags carry a liquidity floor, risk caps from the price paid and a breakout-day state with volume. Trades of the five named strategies bought from 14 November 2026 follow the strategy's own exit line in the ledger.
- Armed Swing requires the full moving-average stack, volume dry-up and a pivot at least three sessions old, and measures breakout volume against a time-of-day curve.
- Not yet observed over enough production decisions: the rate at which the new Strong Swing gates produce candidates. Five genuine scheduled v4 captures remain required and must not be reconstructed after the fact.
- India Armed has its required 40-session curve. US Armed remains fail-closed until a proper US execution-depth and intraday source is added.
- `npm run audit:strategy-readiness` is the pre-promotion gate: five scheduled v4 captures, at least one Execution Ready result per capture on average, at least 90% India results coverage, and an active 40-session volume curve per served market.

## Current behavior that matters operationally

Armed entries fail closed when live execution evidence or results coverage is missing. India requires `BREEZE_LIVE`; calendar verification can use a complete same-day authoritative NSE window or usable dates under the fallback coverage policy. A successful request with no usable date is insufficient on its own.

Momentum discovery builds patterns from completed sessions and treats the current market session as a separate input. During an open India session, a fresh Breeze quote alone is insufficient: entry-ready classification also requires the matching valid Breeze OHLCV row and positive live volume. A missing or stale live input keeps the setup visible but execution-blocked. Freshness uses expected trading sessions, so weekends and exchange holidays do not create false gaps.

Pending orders are application records, not broker submissions. They carry no holdings/P&L until a user records a confirmed fill. Each partial fill becomes a separate purchased ledger trade while the remainder stays pending.

The scheduler wrapper is used by both `npm run dev` and `npm start`. Bare Next.js scripts do not run those schedules. Corporate results refresh is scheduled at 07:00 and 17:00 IST with startup work; the official NSE calendar is attempted before the Yahoo supplement.

The digest scheduler uses one global target time, default 07:00 IST, with catch-up and bounded retries. Although per-user `send_time` and `last_sent_at` are stored, the sender selects all enabled users without enforcing those fields. Retrying a partial batch can resend to users who already received it.

Mobile candidate pushes disclose ticker/readiness/engine to Expo, while ledger alerts remain generic. The documented release path is local Expo Prebuild followed by Gradle/Xcode. App and package metadata are aligned at 0.1.1, Android version code 2 and iOS build 2. On 15 November 2026, a generated Android debug APK and an unsigned iOS simulator app both compiled successfully; signed physical-device installation remains a separate release gate.

## Verification available in the repository

```bash
npm test
npm run lint
npm run build
npm run deploy:check:local
```

Mobile:

```bash
cd mobile
npm run typecheck
npm run validate:release
```

Focused tests exist for Armed Swing, plan validation, pending fills, execution plans, results-calendar ingestion, Gmail token errors and ML features/labels, alongside the wider analytics suite. Python tests are present in `pipelines/`, `workers/` and `scripts/`; they are not all invoked by `npm test`.

The Linux release runs production dependency audit, build and schema verification, then restarts services and checks `/login`. Tests and lint are separate pre-release steps. No application test run or provider-backed verification is claimed by this documentation review.

## Remaining work and runtime checks

- Reconfirm the deployed revision, services and schema through the latest migration after each release.
- The 17 November contention fixes are unproven under load: they were deployed after the India
  session closed. Recheck `/terminal/in/strong-swing` responsiveness and the SIGTERM rate during
  the next open session. If it is still slow, the remaining suspect is the page running a full
  multi-thousand-stock scan per request rather than reading a cached scan.
- `DHAMPURSUG` closed below its recorded stop of 191.59 on 2026-10-19 and is still open in the
  ledger; the ledger records no exit. Decide the position and review why no exit was raised.
- Database snapshots are written on the host only; no off-host copy exists.
- Mid-way momentum has no measured record. The NSE EOD worker now detects an incomplete
  delivery history independently of OHLCV freshness and fills at least forty sessions,
  but production still needs that first backfill after deployment. The thresholds should
  then be replayed the way the Strong Swing entry band was before they are trusted.
- `npm run build` reports a known Next.js security advisory for the installed version.
  The build completes; the upgrade has not been applied and is a deliberate decision
  left to the maintainer.
- Inspect Data Health, quote/depth freshness, calendar coverage and provider failures.
- Review unresolved CAS/fund mappings and Gmail documents needing manual review.
- Confirm daily Breeze session validity and separately authorized buying limits.
- Sign and install newly generated Android and iOS release binaries on physical devices, then exercise login, biometrics, notifications, deep links, market screens and ledger mutations. Native debug/simulator compilation passes, but is not device evidence.
- Implement and validate ML training, calibration, serving and monitoring before treating the design contract as an active model.
- Migration 0079 provides one durable email-digest claim per user and India market date and durable UUID idempotency for mobile ledger mutations. Production behavior remains pending until the migration is deployed and exercised end to end.

See [AI review handoff](AI_REVIEW_HANDOFF.md), [capabilities](CAPABILITIES.md), [architecture](ARCHITECTURE.md) and [deployment](DEPLOYMENT.md).
