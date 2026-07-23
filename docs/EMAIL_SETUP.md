# Email Digest Setup Guide

InvestoGenie can send daily morning emails with the top 5 stocks from your swing candidates and probability screens.

## Prerequisites

1. **Nodemailer** (already installed): handles SMTP email delivery
2. **SMTP Server**: email provider that supports SMTP (Gmail, Outlook, SendGrid relay, etc.)
3. **Environment variables**: configured for your SMTP server

## Configuration

### Step 1: Set up SMTP credentials

Add these environment variables to your `.env.local` file:

```bash
# SMTP Configuration
SMTP_HOST=smtp.gmail.com        # Your SMTP server hostname
SMTP_PORT=587                   # Typically 587 (TLS) or 465 (SSL)
SMTP_USER=your-email@gmail.com  # SMTP username
SMTP_PASS=your-app-password     # App-specific password (not your regular password)
SMTP_FROM=noreply@investogenie  # Display email (optional)

# Cron job authorization
CRON_SECRET=your-secret-key     # Shared secret for cron endpoints
```

### Step 2: Gmail setup (if using Gmail)

If using Gmail:

1. Enable 2-factor authentication on your Google account
2. Create an [App Password](https://myaccount.google.com/apppasswords)
3. Use the 16-character app password as `SMTP_PASS`
4. Set `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=587`

### Step 3: Enable for users

Users can opt into email digests in **Settings → Email digest**:

- Toggle "Enable daily email digest"
- Choose send time (default: 7:00 AM IST)
- Select what to include (swing candidates, probability screen)
- Save preferences

## Cron Job Setup

The email digest is sent via the `/api/cron/send-email-digest` endpoint. You must schedule it to run daily at your chosen time.

### Option 1: External cron service (Recommended)

Use [cron-job.org](https://cron-job.org) or [EasyCron](https://www.easycron.com):

```
URL: https://your-domain.com/api/cron/send-email-digest
Headers: Authorization: Bearer YOUR_CRON_SECRET
Schedule: Daily at 7:00 AM IST (02:30 UTC)
```

### Option 2: Local cron (for development)

Add to your crontab:

```bash
# 7:00 AM IST = 01:30 UTC
30 1 * * * curl -H "Authorization: Bearer $CRON_SECRET" https://localhost:3000/api/cron/send-email-digest
```

### Option 3: Cloud deployment

If deployed to Vercel/Render/etc., use their cron scheduling:

**Vercel (vercel.json):**
```json
{
  "crons": [
    {
      "path": "/api/cron/send-email-digest",
      "schedule": "0 1:30 * * *"
    }
  ]
}
```

## How it works

1. **User opts in** via Settings → Email digest
2. **Daily trigger** at scheduled time (7 AM IST by default)
3. **Top 5 fetched** from swing candidates and probability screens (configurable per user)
4. **Email formatted** with company name, symbol, price, P/E, ROE, ROA, sector
5. **Sent to user** with links back to InvestoGenie for further analysis
6. **Last sent timestamp** recorded in database

## Environment Variables Summary

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `SMTP_HOST` | ✅ | `smtp.gmail.com` | SMTP server hostname |
| `SMTP_PORT` | ✅ | `587` | 587 for TLS, 465 for SSL |
| `SMTP_USER` | ✅ | `user@gmail.com` | SMTP login username |
| `SMTP_PASS` | ✅ | `xxxx xxxx xxxx xxxx` | App password (Gmail) or regular password |
| `SMTP_FROM` | ❌ | `noreply@investogenie` | Display sender (defaults to `SMTP_USER`) |
| `CRON_SECRET` | ✅ | `super-secret-key-123` | Secret for authorizing cron requests |

## Database

A new migration adds the `email_preferences` table:

```sql
create table public.email_preferences (
  id uuid primary key,
  user_id uuid not null unique,
  enabled boolean default false,
  email text not null,
  send_time text default '07:00',
  include_swing_candidates boolean default true,
  include_probability boolean default true,
  last_sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Migration applied automatically on `npm run dev` if not yet applied.

## Troubleshooting

**"ANTHROPIC_API_KEY is not configured"** → NL queries need this for stock filtering. Set `ANTHROPIC_API_KEY` in your `.env.local`.

**"Email configuration incomplete"** → Missing SMTP env vars. Double-check `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`.

**Emails not sending** → Check `/api/cron/send-email-digest` logs via:
- Vercel: Deployments → Functions tab
- Local: `npm run dev` output
- Database: `select * from public.cron_logs order by created_at desc limit 5;`

**Cron endpoint returns 401** → `Authorization: Bearer` header value doesn't match `CRON_SECRET`.

## Testing

To test sending manually:

```bash
curl -X GET http://localhost:3000/api/cron/send-email-digest \
  -H "Authorization: Bearer test-secret"
```

Expected response:

```json
{
  "status": "success",
  "sent": 2,
  "errors": 0,
  "duration": "543ms"
}
```

## Architecture Notes

- **Three-layer email safety**: Only enabled users, only valid SMTP, only if market data is fresh
- **One email per user per day**: Deduplication via `last_sent_at` timestamp
- **Graceful degradation**: If one user's email fails, others still send
- **Logging**: All send attempts logged to `cron_logs` table with full error details
