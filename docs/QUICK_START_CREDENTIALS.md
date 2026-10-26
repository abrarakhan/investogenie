# Quick Start: Credentials and Email Digest

_Source reviewed 26 October 2026 through runtime revision `1c7aac3`._

## 1. Prepare the application

Follow [local setup](../deploy/local/README.md) or [deployment](../DEPLOYMENT.md), including the ordered database migrations. Copy `.env.example` to `.env.local` for local use.

Generate separate random secrets:

```bash
openssl rand -hex 32
```

Copy generated values into named assignments; do not append an unlabeled random line to the environment file.

```dotenv
CREDENTIAL_ENCRYPTION_KEY=YOUR_GENERATED_VALUE
CRON_SECRET=A_DIFFERENT_GENERATED_VALUE
SESSION_SECRET=ANOTHER_GENERATED_VALUE
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Keep exactly one nonempty app URL assignment. Preserve the original credential key when restoring an encrypted database.

## 2. Save SMTP credentials

Start `npm run dev`, sign in and open `/settings`. In secured credentials, enter your SMTP host, port, username and password and save. The digest sender specifically requires the signed-in user's stored SMTP credentials; SMTP environment variables alone do not configure it.

## 3. Enable the digest

Enable Email digest and select Strong Swing and/or Probability content. Current digest data is for India and includes up to five rows per selected section.

The wrapper schedules all enabled users at a global time: 07:00 IST by default. The per-user time field is saved but does not control scheduling in the current implementation.

## 4. Optional AI/news setup

Settings supports an active Anthropic, OpenAI, Google or DeepSeek provider/model/key. News supports Marketaux, GNews, NewsAPI and Alpha Vantage. AI/news keys are independent of SMTP. Saved secrets are encrypted; the UI receives presence flags.

## 5. Verify

`npm run dev` and `npm start` already run the scheduler. No external cron is required for that setup. A host with only Next.js running needs a separate scheduler.

An operator can trigger an actual send to all enabled users with the configured secret exported in the shell:

```bash
curl http://localhost:3000/api/cron/send-email-digest \
  -H "Authorization: Bearer $CRON_SECRET"
```

Inspect `sent`, `errors` and `errorList`, then check `cron_logs` for `send-email-digest`. Repeated manual calls and partial retries can resend to successful recipients; the sender does not enforce `last_sent_at` deduplication.

See [email setup](EMAIL_SETUP.md) for scheduling controls and [credential security](SECURE_CREDENTIALS.md) for storage and recovery.
