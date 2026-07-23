# Quick Start: Secure Credentials & Email Digest

Get your email digest working in 5 minutes using the new encrypted credential storage.

## Step 1: Set Encryption Master Key (1 minute)

Generate a random encryption key and add to `.env.local`:

```bash
# Option A: Use openssl (macOS/Linux)
openssl rand -hex 32 >> .env.local

# Option B: Use Node (anywhere)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and add to `.env.local`:

```bash
CREDENTIAL_ENCRYPTION_KEY=your_generated_hex_here
```

## Step 2: Enable Email Digest in Settings (1 minute)

1. Start the dev server:
   ```bash
   npm run dev
   ```

2. Go to `http://localhost:3000/settings`

3. Scroll to "Email digest" section:
   - Toggle "Enable daily email digest"
   - Choose time (7 AM IST default is fine)
   - Check both options: ☑️ Swing candidates + ☑️ Probability screen
   - Click "Save preferences"

## Step 3: Store SMTP Credentials (2 minutes)

Still in Settings, scroll to "Secured credentials" section:

### For Gmail:

1. Get an app password:
   - Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   - Select "Mail" → "Windows Computer"
   - Copy the 16-character password Google generates

2. In Settings → SMTP:
   - Host: `smtp.gmail.com`
   - Port: `587`
   - Username: `abrar.akhan@gmail.com`
   - Password: Paste the 16-char app password
   - Click "Save SMTP"

### For Other Email Providers:

| Provider | Host | Port |
|----------|------|------|
| Gmail | `smtp.gmail.com` | 587 |
| Outlook | `smtp-mail.outlook.com` | 587 |
| SendGrid | `smtp.sendgrid.net` | 587 |
| AWS SES | `email-smtp.{region}.amazonaws.com` | 587 |

## Step 4: (Optional) Store AI API Keys

In Settings → AI Providers:

**For Claude (Anthropic):**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create API key
3. Paste in "Anthropic (Claude)" field
4. Click "Save API Keys"

**For ChatGPT (OpenAI):**
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create secret key
3. Paste in "OpenAI (GPT)" field
4. Click "Save API Keys"

## Step 5: Test Email Sending (1 minute)

Trigger the email digest manually:

```bash
curl -X GET http://localhost:3000/api/cron/send-email-digest \
  -H "Authorization: Bearer local-dev-cron-secret"
```

**Expected response:**
```json
{
  "status": "success",
  "sent": 1,
  "errors": 0,
  "duration": "543ms"
}
```

**Check your inbox** for the email from noreply@investogenie!

### If it doesn't work:

```bash
# Check the cron logs
psql postgresql://localhost:5432/investogenie -c \
  "select * from public.cron_logs where job = 'send-email-digest' order by created_at desc limit 1;"
```

Look for error details in the `detail` column.

## What Happens Now

✅ Email digest enabled  
✅ SMTP credentials encrypted in database  
✅ (Optional) AI keys securely stored  
✅ Ready for scheduled sends  

### Next: Schedule Daily Sends

You'll need to set up external scheduling since local dev doesn't auto-run crons:

**Option A: cron-job.org (free, easy)**
1. Sign up at [cron-job.org](https://cron-job.org)
2. Create new cronjob:
   - URL: `http://your-domain.com/api/cron/send-email-digest`
   - Headers: `Authorization: Bearer local-dev-cron-secret`
   - Schedule: Daily at 7:00 AM IST (02:30 UTC)
3. Save

**Option B: Deploy to Vercel**
```bash
# Push to GitHub, then:
# 1. Deploy to Vercel via GitHub integration
# 2. Add to vercel.json:
{
  "crons": [{
    "path": "/api/cron/send-email-digest",
    "schedule": "0 1:30 * * *"
  }]
}
# 3. Push again to activate cron
```

**Option C: Local cron (macOS/Linux)**
```bash
# Edit crontab:
crontab -e

# Add (sends at 7 AM IST = 1:30 AM UTC):
30 1 * * * curl -X GET http://localhost:3000/api/cron/send-email-digest -H "Authorization: Bearer local-dev-cron-secret" >> /tmp/email-digest.log 2>&1
```

## Security Reminder

🔒 Your encryption key (`CREDENTIAL_ENCRYPTION_KEY`):
- Is never stored in the database
- Is never logged
- Must be different per environment
- Should be backed up securely
- If lost, existing credentials can't be recovered (but app falls back to env vars)

That's it! You now have:
- 📧 Secure email credential storage
- 🔐 AES-256-GCM encryption
- 🤖 Optional AI API key storage
- 📨 Daily email digest of top stocks

Enjoy your morning stock alerts! 🚀
