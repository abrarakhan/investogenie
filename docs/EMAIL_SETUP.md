# Email Digest Setup

_Source reviewed 26 October 2026 through runtime revision `1c7aac3`._

The daily digest uses the same server sources as India Strong Swing and Probability. Each enabled section includes up to five rows. Email delivery does not place orders.

## Configuration

1. Apply the database migrations, including 0020 email preferences, 0021 credentials and later credential schema updates.
2. Set `CREDENTIAL_ENCRYPTION_KEY`, `CRON_SECRET` and the correct `NEXT_PUBLIC_APP_URL` in the environment.
3. Sign in, open Settings and save the user's SMTP host, port, username and password under secured credentials.
4. Enable Email digest and select its content.

`lib/email-actions.ts:sendEmailDigest()` loads SMTP from that user's `user_credentials` row and decrypts the stored password. It does not call the environment-fallback SMTP resolver. Missing saved credentials produces `SMTP credentials not configured for user`.

The transport uses TLS mode according to port configuration; use the settings required by your SMTP service. SMTP authentication is separate from the read-only Gmail disclosure OAuth integration.

## Scheduling

Both `npm run dev` and `npm start` invoke `scripts/run-with-nse-sync.mjs`, including its daily digest scheduler. Keep the application running to receive scheduled work. Bare `dev:next`/`start:next` commands skip the wrapper.

| Variable | Default | Meaning |
| --- | --- | --- |
| `EMAIL_DIGEST_HOUR_IST` | 7 | Global send hour in IST |
| `EMAIL_DIGEST_MINUTE_IST` | 0 | Global send minute |
| `EMAIL_DIGEST_CRON_DISABLED` | unset | Set 1 to disable wrapper delivery |
| `EMAIL_DIGEST_MAX_ATTEMPTS` | 5 | Attempt budget per IST day |
| `EMAIL_DIGEST_RETRY_MINUTES` | 5 | Retry delay |

The scheduler checks every minute, supports catch-up after the target and seeds its last successful day from database logs. A partial/error response can trigger another bounded attempt.

The UI stores a per-user `send_time`, but the current scheduler does not use it. The enabled-user query also does not filter by `last_sent_at`. Successful sends update that timestamp, but it is not an exactly-once guard: a retry after a partial batch may resend to users whose earlier send succeeded.

## Manual and external invocation

`GET /api/cron/send-email-digest` accepts the configured `Authorization: Bearer` header. Configure a real nonempty `CRON_SECRET`; do not rely on missing-secret behavior.

The following sends real email to all enabled users; export the configured secret in the shell first:

```bash
curl http://localhost:3000/api/cron/send-email-digest \
  -H "Authorization: Bearer $CRON_SECRET"
```

Responses include `status` (`success`, `partial` or failure), `sent`, `errors`, elapsed `duration` and error details. A partial batch is reported in the JSON body, so inspect it even when HTTP succeeds.

If running without the wrapper, use one external scheduler. 07:00 IST equals 01:30 UTC; a five-field UTC cron expression is `30 1 * * *`. The committed `vercel.json` does not currently contain the digest endpoint. Disable wrapper delivery if intentionally moving scheduling elsewhere.

## Monitoring and troubleshooting

```sql
select *
from public.cron_logs
where job = 'send-email-digest'
order by created_at desc
limit 10;
```

- Missing SMTP: save complete credentials for each enabled user.
- Decryption failure: restore the original encryption key or re-enter the affected secret.
- Unauthorized request: ensure the bearer matches the configured cron secret.
- Missing scheduled send: inspect wrapper uptime, disable flags, global IST target, retry budget and logs.
- Repeated email: check manual callers, multiple schedulers and partial-batch retries.
- Empty candidates: inspect the India Strong Swing and Probability data sources; there is no separate documented freshness gate in the mail sender.

The route processes users independently and logs a batch summary; one user's failure does not prevent attempts for the others.

See [quick start](QUICK_START_CREDENTIALS.md) and [credential storage](SECURE_CREDENTIALS.md).
