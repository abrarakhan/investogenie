# Credential Storage

_Source reviewed 25 October 2026 against main revision `42eea8f`._

## Implementation

`lib/crypto/credentials.ts` uses AES-256-GCM. A 32-byte key is derived from `CREDENTIAL_ENCRYPTION_KEY` using scrypt and the fixed application salt `investogenie-credential-salt`. Each encrypted value uses a random 16-byte IV and an authentication tag.

Stored format:

```text
iv:authTag:ciphertext
```

All three components are hexadecimal. The master key comes from the environment, not the database. This encrypts selected secret fields; it does not encrypt the entire database or backups.

## Credential domains

| Data | Storage/resolution |
| --- | --- |
| SMTP password and host/port/user metadata | `user_credentials`; password encrypted |
| Active AI provider/model/key | Provider/model metadata plus encrypted key |
| News provider keys | Legacy credential fields and multi-provider `user_news_providers` |
| Breeze API key, secret and session token | Encrypted user credential fields |
| Gmail OAuth tokens and optional CAS password | Gmail connection domain, encrypted secrets |
| Mobile device session | Raw token in SecureStore; only SHA-256 hash on server |

The baseline credential schema is migration 0021; later migrations extend AI, news and Breeze. Gmail health fields are added by 0057. Apply the full ordered schema for a fresh database; startup is not a general migration runner.

## Setup and recovery

Generate a high-entropy master value:

```bash
openssl rand -hex 32
```

Save it as `CREDENTIAL_ENCRYPTION_KEY=...` in local `.env.local` or the deployment's protected environment file. Generate session/cron secrets independently.

Preserve the original master key alongside recoverable backups using a separate protected storage location. Restoring encrypted records under another key will not decrypt them. Changing the variable alone is not credential rotation: decrypt/re-encrypt under controlled migration or re-enter secrets. If the original key is lost, existing encrypted secrets cannot be recovered.

## Settings and server access

`lib/credentials-actions.ts` requires authentication for user-facing updates and scopes rows to the user. `getUserCredentials()` returns client-safe metadata and flags such as `smtpPasswordSet` and `aiApiKeySet`. It does not return decrypted passwords or keys.

`updateCredentials()` encrypts submitted secret values before writing. Clearing is explicit through `clearCredential()`; blank update fields preserve existing encrypted values.

Server-only resolvers such as `getActiveAIConfig()`, `getSystemAIConfig()`, news resolvers and `getSMTPConfig()` may return plaintext secrets for provider calls. Never pass these results to client props, logs or API responses.

```typescript
import { encryptCredential, decryptCredential } from "@/lib/crypto/credentials";

// Server-only operations; do not log either value.
const stored = encryptCredential(secret);
const restored = decryptCredential(stored);
```

There is no current `getAIProviderKey()` API. The natural-language screener resolves the chosen provider/model/key through `getActiveAIConfig()` and dispatches through `lib/screener/nlQuery.ts`.

## Fallbacks are caller-specific

Interactive AI first uses the user's saved configuration; system AI has its own environment/default-user resolution. Multi-provider news resolution differs from legacy single-provider fallback. Read the relevant resolver before assuming an environment key is used.

`getSMTPConfig()` supports database/environment resolution for its callers. The daily digest does not use that helper: `sendEmailDigest(userId)` requires that user's stored SMTP host/user/encrypted password. Environment `SMTP_*` values alone do not enable digest delivery.

Gmail refresh errors can set `needs_reconnect`; Fund Mapping exposes the last scan error/timestamp. A new OAuth consent clears reconnect/error state on successful reconnection. Repeated failures require inspecting the connector's reported error, not changing the encryption key.

## Troubleshooting

- Missing master-key error: configure the same key in every process that reads encrypted records.
- Invalid encrypted format: verify the stored three-part value and restore a valid backup or re-enter it.
- Authentication/decryption failure after restore: verify the original master key before replacing records.
- Credentials appear unset: confirm the user and saved presence flags; do not inspect secrets in logs.
- Provider authentication failure with valid storage: verify the provider key/session separately.

Access control, HTTPS, host security and protected backups remain separate controls. This storage implementation alone is not evidence of regulatory certification.

See [email setup](EMAIL_SETUP.md), [quick start](QUICK_START_CREDENTIALS.md) and [deployment](../DEPLOYMENT.md).
