"use server";

import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { encryptCredential } from "@/lib/crypto/credentials";
import { triggerBreezeReconciliation } from "@/lib/breeze/reconciliation";
import { isAIProvider, type AIProvider } from "@/lib/ai/providers";
import { NEWS_PROVIDERS, type NewsProvider } from "@/lib/credentials.server";

// Every export of this "use server" module is a browser-callable Server Action.
// Only export authenticated, user-scoped functions that return no decrypted
// secrets. Secret resolvers live in lib/credentials.server.ts.
export type { NewsProvider };

export interface StoredCredentials {
  id: string;
  userId: string;
  // SMTP
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPasswordSet: boolean;
  // Active AI provider config
  aiProvider: AIProvider | null;
  aiModel: string | null;
  aiApiKeySet: boolean;
  newsProvider: NewsProvider | null;
  newsApiKeySet: boolean;
  breezeApiKeySet: boolean;
  breezeApiSecretSet: boolean;
  breezeSessionTokenSet: boolean;
  breezeSessionUpdatedAt: Date | null;
  updatedAt: Date;
}

export interface CredentialsInput {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  aiProvider?: AIProvider;
  aiModel?: string;
  aiApiKey?: string;
  newsProvider?: NewsProvider;
  newsApiKey?: string;
  breezeApiKey?: string;
  breezeApiSecret?: string;
  breezeSessionToken?: string;
}


interface CredsRow {
  id: string;
  user_id: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password_encrypted: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  ai_api_key_encrypted: string | null;
  news_provider: string | null;
  news_api_key_encrypted: string | null;
  breeze_api_key_encrypted: string | null;
  breeze_api_secret_encrypted: string | null;
  breeze_session_token_encrypted: string | null;
  breeze_session_updated_at: Date | null;
  updated_at: Date;
}

const SELECT_COLS = `id, user_id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
                     ai_provider, ai_model, ai_api_key_encrypted,
                     news_provider, news_api_key_encrypted,
                     breeze_api_key_encrypted, breeze_api_secret_encrypted,
                     breeze_session_token_encrypted, breeze_session_updated_at, updated_at`;

/** Map a DB row to the client-safe shape (never exposes decrypted secrets). */
function mapCredentials(row: CredsRow): StoredCredentials {
  return {
    id: row.id,
    userId: row.user_id,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpUser: row.smtp_user,
    smtpPasswordSet: !!row.smtp_password_encrypted,
    aiProvider: isAIProvider(row.ai_provider) ? row.ai_provider : null,
    aiModel: row.ai_model,
    aiApiKeySet: !!row.ai_api_key_encrypted,
    newsProvider: NEWS_PROVIDERS.has(row.news_provider as NewsProvider)
      ? (row.news_provider as NewsProvider)
      : null,
    newsApiKeySet: !!row.news_api_key_encrypted,
    breezeApiKeySet: !!row.breeze_api_key_encrypted,
    breezeApiSecretSet: !!row.breeze_api_secret_encrypted,
    breezeSessionTokenSet: !!row.breeze_session_token_encrypted,
    breezeSessionUpdatedAt: row.breeze_session_updated_at,
    updatedAt: row.updated_at,
  };
}

/** Client-safe credentials for the current user (no decrypted secrets). */
export async function getUserCredentials(): Promise<StoredCredentials | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const row = await queryOne<CredsRow>(
    `select ${SELECT_COLS} from public.user_credentials where user_id = $1`,
    [user.id],
  );
  return row ? mapCredentials(row) : null;
}

/** Create or update credentials for the current user. */
export async function updateCredentials(input: CredentialsInput): Promise<StoredCredentials> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");

  if (input.aiProvider && !isAIProvider(input.aiProvider)) {
    throw new Error(`Unsupported AI provider: ${input.aiProvider}`);
  }

  const encSmtp = input.smtpPassword ? encryptCredential(input.smtpPassword) : undefined;
  const encAiKey = input.aiApiKey ? encryptCredential(input.aiApiKey) : undefined;
  const encNewsKey = input.newsApiKey ? encryptCredential(input.newsApiKey) : undefined;
  const encBreezeApiKey = input.breezeApiKey ? encryptCredential(input.breezeApiKey.trim()) : undefined;
  const encBreezeApiSecret = input.breezeApiSecret ? encryptCredential(input.breezeApiSecret.trim()) : undefined;
  const encBreezeSessionToken = input.breezeSessionToken ? encryptCredential(input.breezeSessionToken.trim()) : undefined;

  if (input.newsProvider && !NEWS_PROVIDERS.has(input.newsProvider)) {
    throw new Error(`Unsupported news provider: ${input.newsProvider}`);
  }

  const existing = await queryOne<CredsRow>(
    `select ${SELECT_COLS} from public.user_credentials where user_id = $1`,
    [user.id],
  );

  if (!existing) {
    const row = await queryOne<CredsRow>(
      `insert into public.user_credentials
         (user_id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
          ai_provider, ai_model, ai_api_key_encrypted,
          news_provider, news_api_key_encrypted,
          breeze_api_key_encrypted, breeze_api_secret_encrypted,
          breeze_session_token_encrypted, breeze_session_updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               case when $13::text is null then null else now() end)
       returning ${SELECT_COLS}`,
      [
        user.id,
        input.smtpHost ?? null,
        input.smtpPort ?? null,
        input.smtpUser ?? null,
        encSmtp ?? null,
        input.aiProvider ?? null,
        input.aiModel ?? null,
        encAiKey ?? null,
        input.newsProvider ?? null,
        encNewsKey ?? null,
        encBreezeApiKey ?? null,
        encBreezeApiSecret ?? null,
        encBreezeSessionToken ?? null,
      ],
    );
    if (!row) throw new Error("Failed to create credentials");
    if (encBreezeSessionToken) await triggerBreezeReconciliation();
    return mapCredentials(row);
  }

  const row = await queryOne<CredsRow>(
    `update public.user_credentials set
        smtp_host = coalesce($2, smtp_host),
        smtp_port = coalesce($3, smtp_port),
        smtp_user = coalesce($4, smtp_user),
        smtp_password_encrypted = coalesce($5, smtp_password_encrypted),
        ai_provider = coalesce($6, ai_provider),
        ai_model = coalesce($7, ai_model),
        ai_api_key_encrypted = coalesce($8, ai_api_key_encrypted),
        news_provider = coalesce($9, news_provider),
        news_api_key_encrypted = coalesce($10, news_api_key_encrypted),
        breeze_api_key_encrypted = coalesce($11, breeze_api_key_encrypted),
        breeze_api_secret_encrypted = coalesce($12, breeze_api_secret_encrypted),
        breeze_session_token_encrypted = coalesce($13, breeze_session_token_encrypted),
        breeze_session_updated_at = case when $13::text is null then breeze_session_updated_at else now() end,
        updated_at = now()
      where user_id = $1
      returning ${SELECT_COLS}`,
    [
      user.id,
      input.smtpHost ?? null,
      input.smtpPort ?? null,
      input.smtpUser ?? null,
      encSmtp ?? null,
      input.aiProvider ?? null,
      input.aiModel ?? null,
      encAiKey ?? null,
      input.newsProvider ?? null,
      encNewsKey ?? null,
      encBreezeApiKey ?? null,
      encBreezeApiSecret ?? null,
      encBreezeSessionToken ?? null,
    ],
  );
  if (!row) throw new Error("Failed to update credentials");
  if (encBreezeSessionToken) await triggerBreezeReconciliation();
  return mapCredentials(row);
}

/** Clear a single secret without disturbing the others. */
export async function clearCredential(field: "smtpPassword" | "aiApiKey" | "newsApiKey" | "breeze"): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  if (field === "breeze") {
    await query(
      `update public.user_credentials set
         breeze_api_key_encrypted=null,breeze_api_secret_encrypted=null,
         breeze_session_token_encrypted=null,breeze_session_updated_at=null,updated_at=now()
       where user_id=$1`,
      [user.id],
    );
    return;
  }
  const column = field === "smtpPassword"
    ? "smtp_password_encrypted"
    : field === "aiApiKey" ? "ai_api_key_encrypted" : "news_api_key_encrypted";
  await query(
    `update public.user_credentials set ${column} = null, updated_at = now() where user_id = $1`,
    [user.id],
  );
}

export interface StoredNewsProvider { provider: NewsProvider; enabled: boolean }

export async function getUserNewsProviders(): Promise<StoredNewsProvider[]> {
  const user = await getSessionUser();
  if (!user) return [];
  return query<StoredNewsProvider>(
    `select provider,enabled from public.user_news_providers where user_id=$1 order by provider`,
    [user.id],
  );
}

export async function saveNewsProvider(provider: NewsProvider, apiKey: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  if (!NEWS_PROVIDERS.has(provider) || !apiKey.trim()) throw new Error("Select a provider and enter its API key.");
  await query(
    `insert into public.user_news_providers(user_id,provider,api_key_encrypted,enabled)
     values($1,$2,$3,true) on conflict(user_id,provider) do update set
     api_key_encrypted=excluded.api_key_encrypted,enabled=true,updated_at=now()`,
    [user.id, provider, encryptCredential(apiKey.trim())],
  );
}

export async function removeNewsProvider(provider: NewsProvider): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  await query(`delete from public.user_news_providers where user_id=$1 and provider=$2`, [user.id, provider]);
}
