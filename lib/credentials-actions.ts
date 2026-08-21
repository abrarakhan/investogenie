"use server";

import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { encryptCredential, decryptCredential } from "@/lib/crypto/credentials";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  isAIProvider,
  type AIProvider,
} from "@/lib/ai/providers";

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
}

export type NewsProvider = "alpha_vantage" | "gnews" | "newsapi";
const NEWS_PROVIDERS = new Set<NewsProvider>(["alpha_vantage", "gnews", "newsapi"]);

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
  updated_at: Date;
}

const SELECT_COLS = `id, user_id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
                     ai_provider, ai_model, ai_api_key_encrypted,
                     news_provider, news_api_key_encrypted, updated_at`;

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
          news_provider, news_api_key_encrypted)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      ],
    );
    if (!row) throw new Error("Failed to create credentials");
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
    ],
  );
  if (!row) throw new Error("Failed to update credentials");
  return mapCredentials(row);
}

/** Clear a single secret without disturbing the others. */
export async function clearCredential(field: "smtpPassword" | "aiApiKey" | "newsApiKey"): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  const column = field === "smtpPassword"
    ? "smtp_password_encrypted"
    : field === "aiApiKey" ? "ai_api_key_encrypted" : "news_api_key_encrypted";
  await query(
    `update public.user_credentials set ${column} = null, updated_at = now() where user_id = $1`,
    [user.id],
  );
}

export interface ActiveNewsConfig {
  provider: NewsProvider;
  apiKey: string;
}

/** Resolve a user's news API, falling back to deployment environment keys. */
export async function getActiveNewsConfig(): Promise<ActiveNewsConfig | null> {
  const user = await getSessionUser();
  if (user) {
    const row = await queryOne<{ news_provider: string | null; news_api_key_encrypted: string | null }>(
      `select news_provider, news_api_key_encrypted from public.user_credentials where user_id = $1`,
      [user.id],
    );
    if (row?.news_api_key_encrypted && NEWS_PROVIDERS.has(row.news_provider as NewsProvider)) {
      return {
        provider: row.news_provider as NewsProvider,
        apiKey: decryptCredential(row.news_api_key_encrypted),
      };
    }
  }
  return getEnvironmentNewsConfig();
}

/** Cron-safe resolver. Global jobs may only consume deployment-owned keys. */
export async function getSystemNewsConfig(): Promise<ActiveNewsConfig | null> {
  return getEnvironmentNewsConfig();
}

function getEnvironmentNewsConfig(): ActiveNewsConfig | null {
  if (process.env.ALPHA_VANTAGE_API_KEY) return { provider: "alpha_vantage", apiKey: process.env.ALPHA_VANTAGE_API_KEY };
  if (process.env.GNEWS_API_KEY) return { provider: "gnews", apiKey: process.env.GNEWS_API_KEY };
  if (process.env.NEWS_API_KEY) return { provider: "newsapi", apiKey: process.env.NEWS_API_KEY };
  return null;
}

export interface ActiveAIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
}

/**
 * Resolve the AI config the NL screener should use for the current user:
 * the stored provider/model/key when present, otherwise an Anthropic fallback
 * from the ANTHROPIC_API_KEY env var. Returns null when nothing is configured.
 * Decrypts the key — server-only; never send the result to the client.
 */
export async function getActiveAIConfig(): Promise<ActiveAIConfig | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const row = await queryOne<CredsRow>(
    `select ai_provider, ai_model, ai_api_key_encrypted from public.user_credentials where user_id = $1`,
    [user.id],
  );

  if (row?.ai_api_key_encrypted && isAIProvider(row.ai_provider)) {
    return {
      provider: row.ai_provider,
      model: row.ai_model || DEFAULT_MODEL_BY_PROVIDER[row.ai_provider],
      apiKey: decryptCredential(row.ai_api_key_encrypted),
    };
  }

  // Fallback: env-configured Anthropic key (keeps the feature working without
  // per-user setup, e.g. local dev).
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: DEFAULT_MODEL_BY_PROVIDER.anthropic,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  return null;
}

/** Cron-safe AI resolver. Global jobs may only consume deployment-owned keys. */
export async function getSystemAIConfig(): Promise<ActiveAIConfig | null> {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: DEFAULT_MODEL_BY_PROVIDER.anthropic,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", model: DEFAULT_MODEL_BY_PROVIDER.openai, apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    return { provider: "google", model: DEFAULT_MODEL_BY_PROVIDER.google, apiKey: process.env.GOOGLE_AI_API_KEY };
  }
  return null;
}

/** SMTP config for email sending. Prefers per-user DB creds, falls back to env. */
export async function getSMTPConfig(): Promise<{
  host: string;
  port: number;
  user: string;
  password: string;
} | null> {
  const result = await queryOne<{
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
    smtp_password_encrypted: string | null;
  }>(
    `select smtp_host, smtp_port, smtp_user, smtp_password_encrypted
     from public.user_credentials
     where user_id = (select id from public.users where email = $1)
     limit 1`,
    [process.env.DEFAULT_USER_EMAIL || ""],
  );

  if (result?.smtp_host && result.smtp_user && result.smtp_password_encrypted) {
    return {
      host: result.smtp_host,
      port: result.smtp_port || 587,
      user: result.smtp_user,
      password: decryptCredential(result.smtp_password_encrypted),
    };
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASS,
    };
  }

  return null;
}
