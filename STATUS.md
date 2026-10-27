# InvestoGenie Status

_Code and production baseline reviewed 26 October 2026 through runtime revision `1c7aac3` on main. This documentation commit does not alter runtime behavior._

This is a repository status reference. The production web/Breeze services, login endpoint, schema and one candidate scan were checked at revision `1c7aac3`; broker account contents and installed mobile binaries were not inspected. The checks below are a dated baseline, not a guarantee of continuing provider or market-data health.

## Implemented in the reviewed source

- Next.js 16.4.2 / React 19.2.4 web application with India/US terminal routes.
- Fundamental/price-action Stock Screener, natural-language filtering, saved screens and exports.
- Swing, Strong Swing, legacy/V2 Momentum Ignition, News & AI, Long-Term and Probability research surfaces.
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

The shared Linux release script applies an explicit 0033–0060 list. Fresh databases still need the full ordered schema. `scripts/verify-production-schema.mjs` checks required relations, including `candidate_signal_observations` and `trend_continuation_signals`, plus authoritative-calendar and Gmail-health columns. After pulling, the release script re-executes the checked-out version once so a migration added in the same release is applied.

Trend Continuation v1 is an India-only, Python-calculated observation engine for persistent 3–5 session moves. It stores versioned impulse/watch/ready/extended states, appears on web and mobile Strong Swing surfaces, and participates in ready-transition notifications. It cannot create an execution plan, unlock Buy & Track, or feed auto-buy.

## Verified production baseline — 26 October 2026

- Revision `1c7aac3` was checked out cleanly; web and Breeze services were active and `/login` returned HTTP 200.
- Production dependency audit reported zero known vulnerabilities at the configured severity gate.
- A candidate scan evaluated 40 candidates for the configured account even without an enabled push token, persisted 40 observations and refreshed live targets.
- The Breeze worker reconciled its bounded subscriptions from those targets without a restart. These counts describe that verification run only.

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

- Reconfirm the deployed revision, services and schema through 0059 after each release.
- Inspect Data Health, quote/depth freshness, calendar coverage and provider failures.
- Review unresolved CAS/fund mappings and Gmail documents needing manual review.
- Confirm daily Breeze session validity and separately authorized buying limits.
- Validate a newly generated mobile binary on physical devices; source metadata is not install evidence.
- Implement and validate ML training, calibration, serving and monitoring before treating the design contract as an active model.
- Check email retry/deduplication behavior before relying on exactly-once delivery or individual send times.

See [capabilities](CAPABILITIES.md), [architecture](ARCHITECTURE.md) and [deployment](DEPLOYMENT.md).
