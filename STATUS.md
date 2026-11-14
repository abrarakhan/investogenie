# InvestoGenie Status

_Code and production baseline reviewed 14 November 2026 through deployed revision `f33f256` on main._

This is a repository status reference. The production web/Breeze services, HTTPS login endpoint, schema through 0077, India results coverage and India Armed volume curve were checked at revision `f33f256`; broker account contents and installed mobile binaries were not inspected. The checks below are a dated baseline, not a guarantee of continuing provider or market-data health.

## Implemented in the reviewed source

- Next.js 16.4.2 / React 19.2.4 web application with India/US terminal routes.
- Fundamental/price-action Stock Screener, natural-language filtering, saved screens and exports.
- Swing, Strong Swing, legacy/V2 Momentum Ignition, News & AI, Long-Term and Probability research surfaces.
- Trading strategy calculations are Python-authoritative: Base Swing, named strategies, Strong Swing, Momentum, Trend Continuation, Armed Swing, News overlays and ledger projections. TypeScript loaders assemble inputs and consume versioned batch results; legacy TypeScript formulas are retained only as differential-test oracles.
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

The shared Linux release script discovers and applies migrations from 0033 onward in filename order. Fresh databases still need the full ordered schema. `scripts/verify-production-schema.mjs` checks required relations, including candidate observations, trend-continuation signals, browser-notification events, broker-order audits and market-volume curves. Browser notification signatures are unique per user and market day, and polling is serialized across open tabs. Trade-alert identity uses stable decision state rather than changing quote explanation text. After pulling, the release script re-executes the checked-out version once so a migration added in the same release is applied.

Authenticated web pages expose an opt-in browser-alert control. While the site is open in a foreground or background tab, it polls deduplicated server events and uses the browser Notification API for candidate-ready transitions and material ledger actions. Permission is requested only from an explicit user click; denied permission is never bypassed.

Trend Continuation v1 is an India-only, Python-calculated engine for persistent 3–5 session moves. It stores versioned impulse/watch/ready/extended states and appears on web and mobile Strong Swing surfaces. Day-one impulses and later pullbacks remain observational. A confirmed day-two breakout after 10:15 IST can create an immutable manual Buy & Track plan only when fresh Breeze depth, spread, circuit room, results-calendar, price-range and plan-freshness gates pass. It never feeds auto-buy.

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

- Strong Swing is model `strong-swing-v4-breakout-bar`: breakout quality is judged on the bar that broke out, stocks holding a two-close breakout are assessed even when the base scan lists no setup, the trend needs the 50-day above the 200-day, a live price below the entry waits, and India entries need a verified results calendar with no results within three sessions. Plans and captures from v3 are refused at purchase and by auto-buy.
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

Mobile candidate pushes disclose ticker/readiness/engine to Expo, while ledger alerts remain generic. The documented local build path coexists with EAS Build scripts/configuration. App metadata is 0.1.1, Android version code 2, iOS build 2; package version remains 0.1.0.

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
- Inspect Data Health, quote/depth freshness, calendar coverage and provider failures.
- Review unresolved CAS/fund mappings and Gmail documents needing manual review.
- Confirm daily Breeze session validity and separately authorized buying limits.
- Validate a newly generated mobile binary on physical devices; source metadata is not install evidence.
- Implement and validate ML training, calibration, serving and monitoring before treating the design contract as an active model.
- Check email retry/deduplication behavior before relying on exactly-once delivery or individual send times.

See [AI review handoff](AI_REVIEW_HANDOFF.md), [capabilities](CAPABILITIES.md), [architecture](ARCHITECTURE.md) and [deployment](DEPLOYMENT.md).
