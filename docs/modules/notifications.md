# Notifications module

Notifications cover three channels: browser (for an open authenticated tab), mobile push through
Expo, and a daily email digest. All three share one principle - delivery must never drive evaluation.
Scans record a candidate's status transition whether or not anyone is subscribed, so the history is
complete and a notification is a consequence of the record rather than its cause.

Deduplication is per signature and market day. Candidate alerts are evaluated only while the relevant
market is open and are discarded before delivery if the candidate is no longer ready. What leaves the
system is limited by channel: ledger alerts are generic, while candidate alerts name the ticker,
readiness state and engine, never prices, quantities or broker values.

## Boundaries and invariants

- Owns browser, mobile and email delivery, status-transition deduplication and preferences.
- Server: `lib/mobileAlerts.ts`, browser notification modules, email digest server, cron routes.
- Tables include notification events/logs, push tokens, alert state and email delivery claims.
- Delivery must not drive candidate evaluation; scans persist transitions even without a push token.
- Mobile target: preferences, history, deep links and grouped notifications.
- Focused checks: notification deduplication, email delivery and mobile alert tests.
