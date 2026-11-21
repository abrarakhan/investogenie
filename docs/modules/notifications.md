# Notifications module

- Owns browser, mobile and email delivery, status-transition deduplication and preferences.
- Server: `lib/mobileAlerts.ts`, browser notification modules, email digest server, cron routes.
- Tables include notification events/logs, push tokens, alert state and email delivery claims.
- Delivery must not drive candidate evaluation; scans persist transitions even without a push token.
- Mobile execution-ready, Mid-Way and ledger-risk preferences are loaded per user by the dispatcher. Disabling delivery never stops per-user signal observation; quiet hours suppress non-critical candidate delivery outside the relevant market session.
- Mobile target: preferences, history, deep links and grouped notifications.
- Focused checks: notification deduplication, email delivery and mobile alert tests.
