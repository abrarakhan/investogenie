# Secure Credentials Storage

InvestoGenie now provides encrypted credential storage for sensitive information like email passwords and AI API keys. This allows users to store their secrets securely in the database instead of relying on environment variables.

## Overview

**Credentials stored:**
- 📧 SMTP configuration (host, port, username, password)
- 🤖 One active AI model: **provider** (Anthropic / OpenAI / Google), **model** (preset or custom ID), and **API key**

The NL screener sends each query to the chosen provider/model using the stored
key. Switching provider/model in Settings → AI model takes effect immediately.
Provider dispatch lives in `lib/screener/nlQuery.ts` (Anthropic via the SDK's
structured output; OpenAI via Chat Completions JSON mode; Google via Gemini
`generateContent` JSON) — all funnel through the same `validateFilter` +
`sanitizeIntent` safety pipeline. Resolution helper: `getActiveAIConfig()` in
`lib/credentials-actions.ts` (falls back to `ANTHROPIC_API_KEY` env when unset).

**Encryption:**
- Algorithm: AES-256-GCM (Advanced Encryption Standard with Galois/Counter Mode)
- Key derivation: scrypt (memory-hard function)
- Random IV per credential (prevents pattern analysis)
- Authentication tag validation (detects tampering)

## Architecture

### Encryption Flow

```
User enters password → Credentials Form (client-side) →
  ↓
Server action (updateCredentials) →
  ↓
encryptCredential(value) → AES-256-GCM encrypt with random IV →
  ↓
Save to database: "iv:authTag:encryptedData" (hex format) →
  ↓
Database (encrypted at rest)
```

### Decryption Flow

```
Read from database: "iv:authTag:encryptedData" →
  ↓
decryptCredential(encryptedValue) →
  ↓
Extract IV and authTag from format →
  ↓
Create decipher with key and IV, set authTag for validation →
  ↓
Decrypt and verify authenticity →
  ↓
Return plaintext to application
```

## Setup

### 1. Set Encryption Master Key

The master key must be stored as an environment variable (secure, random, unique per deployment):

```bash
# Generate a strong key (e.g., with openssl)
openssl rand -hex 32

# Add to .env.local (development)
CREDENTIAL_ENCRYPTION_KEY=abc123def456...

# Or set in your deployment platform:
# - Vercel: Settings → Environment Variables
# - Render: Settings → Environment
# - AWS/Heroku: Secrets manager
```

**Important:**
- This key is NEVER stored in the database
- Different key = unable to decrypt existing credentials
- Treat like a password — secure and back it up

### 2. Database Migration

The migration creates the `user_credentials` table:

```sql
create table public.user_credentials (
  id uuid primary key,
  user_id uuid unique,
  -- SMTP (plaintext: host/port/user, encrypted: password)
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_password_encrypted text,
  -- AI Keys (encrypted)
  anthropic_api_key_encrypted text,
  openai_api_key_encrypted text,
  created_at, updated_at
);
```

The migration is applied automatically on `npm run dev`.

## Usage

### In Settings UI

Go to **Settings → Secured credentials**:

1. **Email (SMTP)** section:
   - Host: `smtp.gmail.com` (or your provider)
   - Port: `587` (TLS) or `465` (SSL)
   - Username: Your email address
   - Password: App password (for Gmail) or regular password
   - Click "Save SMTP"

2. **AI Providers** section:
   - Anthropic API key: Get from `console.anthropic.com`
   - OpenAI API key: Get from `platform.openai.com/api-keys`
   - Click "Save API Keys"

### In Server Actions

Retrieve decrypted credentials:

```typescript
import { getUserCredentials, getAIProviderKey, getSMTPConfig } from "@/lib/credentials-actions";

// Get all credentials for current user
const creds = await getUserCredentials();
console.log(creds.anthropicApiKey); // Decrypted

// Get a specific AI provider key
const claudeKey = await getAIProviderKey("anthropic");
const gptKey = await getAIProviderKey("openai");

// Get SMTP config (prefers DB, falls back to env)
const smtpConfig = await getSMTPConfig();
```

### Encryption / Decryption

```typescript
import { encryptCredential, decryptCredential } from "@/lib/crypto/credentials";

// Encrypt before storage (done automatically in actions)
const encrypted = encryptCredential("my-secret-key");
// Returns: "a1b2c3:d4e5f6:g7h8i9..." (iv:authTag:ciphertext in hex)

// Decrypt for use (done automatically in actions)
const decrypted = decryptCredential(encrypted);
// Returns: "my-secret-key"
```

## Integration with Features

### Email Digest

The email digest cron can use SMTP credentials from the database:

```typescript
// In sendEmailDigest()
const smtpConfig = await getSMTPConfig();
if (smtpConfig) {
  await sendEmail({
    from: smtpConfig.user,
    to: userEmail,
    // ... email content
  });
}
```

### Natural Language Queries

The NL query feature can use the user's Claude API key:

```typescript
// In nlQuery.ts
const apiKey = await getAIProviderKey("anthropic");
const client = new Anthropic({ apiKey });
```

## Security Considerations

### What's Protected

✅ API keys: Encrypted before storage  
✅ SMTP passwords: Encrypted before storage  
✅ Master key: Never exposed in database  
✅ Credentials: Decrypted only when needed  
✅ Validation: Auth tag detects tampering  

### What's NOT Protected

❌ Network: Use HTTPS in production  
❌ Backups: Encrypt database backups  
❌ Logs: Don't log credentials  
❌ Master key: Secure your env vars  

### Best Practices

1. **Master Key:**
   - Use a strong, random key (32+ bytes)
   - Store only in secure environment (not git)
   - Rotate periodically if possible
   - Different key per environment (dev/staging/prod)

2. **Credential Usage:**
   - Decrypt only when needed
   - Don't log decrypted values
   - Clear credentials when user revokes access
   - Consider rate limiting API usage

3. **Backup & Recovery:**
   - Backup the master key securely
   - Test decryption on restore
   - Document recovery procedures
   - Have fallback to env vars during recovery

## Troubleshooting

**"CREDENTIAL_ENCRYPTION_KEY env var is required"**
- The master key is not set in your environment
- Set it: `export CREDENTIAL_ENCRYPTION_KEY=...`

**"Invalid encrypted credential format"**
- The stored value is corrupted
- The decryption failed auth tag validation (tampering detection)
- The encryption key changed (can't decrypt old values)
- Solution: Clear and re-enter the credential

**"Failed to decrypt"**
- The master key changed since encryption
- Database was restored from backup encrypted with different key
- Solution: Restore the correct master key or re-enter credentials

**Can't retrieve API keys in application code**
- Ensure `getUserCredentials()` or `getAIProviderKey()` is awaited
- Check user is authenticated (`getSessionUser()`)
- Verify credentials were actually saved (check database)

## Examples

### Complete Email Digest with DB Credentials

```typescript
import { getSMTPConfig } from "@/lib/credentials-actions";
import { sendEmail } from "@/lib/email/nodemailer-service";

export async function sendEmailDigest(userId: string) {
  const smtpConfig = await getSMTPConfig();
  if (!smtpConfig) throw new Error("SMTP not configured");

  // Configure Nodemailer with DB credentials
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.password,
    },
  });

  await transporter.sendMail({
    from: smtpConfig.user,
    to: userEmail,
    subject: "Daily Digest",
    html: htmlContent,
  });
}
```

### NL Query with User's Claude Key

```typescript
import { getAIProviderKey } from "@/lib/credentials-actions";
import Anthropic from "@anthropic-ai/sdk";

export async function parseScreenQuery(input: ParseScreenQueryInput) {
  const apiKey = await getAIProviderKey("anthropic");
  if (!apiKey) throw new Error("Anthropic API key not configured");

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    messages: [{ role: "user", content: input.query }],
  });

  return message;
}
```

## Migration from Environment Variables

If you're currently using `.env` for credentials:

1. Set `CREDENTIAL_ENCRYPTION_KEY` in your secure env var storage
2. Go to Settings → Secured credentials
3. Enter your SMTP and API key values
4. Click "Save"
5. The values are now encrypted in the database
6. Remove from `.env` files
7. Optionally remove from deployed environment

The application will fall back to env vars if database credentials aren't set, so this migration is non-breaking.

## Data Privacy

- Credentials are stored per user (isolated by `user_id`)
- A user can only access their own credentials (enforced at the application level)
- No user can view another user's credentials
- Credentials are cleared if user account is deleted (`on delete cascade`)

## Compliance

This encryption scheme helps meet:
- **PCI DSS**: Encrypted storage of authentication credentials
- **GDPR**: User control over their API keys
- **SOC 2**: Encryption of sensitive data at rest

Check your compliance requirements before deploying to production.
