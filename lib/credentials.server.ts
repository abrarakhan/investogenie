/**
 * Server-only credential resolvers. These return DECRYPTED news, AI and SMTP
 * secrets, so they must never be exported from a "use server" module (every
 * export there is a browser-callable Server Action) or imported by client code.
 * Callers must already have authorized the request.
 */
import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { decryptCredential } from "@/lib/crypto/credentials";
import { DEFAULT_MODEL_BY_PROVIDER, isAIProvider, type AIProvider } from "@/lib/ai/providers";

export type NewsProvider = "alpha_vantage" | "gnews" | "newsapi" | "marketaux";
export const NEWS_PROVIDERS: ReadonlySet<NewsProvider> = new Set<NewsProvider>(["alpha_vantage", "gnews", "newsapi", "marketaux"]);

export interface ActiveNewsConfig {
  provider: NewsProvider;
  apiKey: string;
}

export async function newsConfigsForUser(userId: string): Promise<ActiveNewsConfig[]> {
  const rows = await query<{ provider: string; api_key_encrypted: string }>(
    `select provider,api_key_encrypted from public.user_news_providers
      where user_id=$1 and enabled order by provider`, [userId],
  );
  return rows.filter((row) => NEWS_PROVIDERS.has(row.provider as NewsProvider)).map((row) => ({
    provider: row.provider as NewsProvider, apiKey: decryptCredential(row.api_key_encrypted),
  }));
}

export async function getActiveNewsConfigs(): Promise<ActiveNewsConfig[]> {
  const user = await getSessionUser();
  if (user) {
    const configs = await newsConfigsForUser(user.id);
    if (configs.length) return configs;
  }
  const legacy = await getActiveNewsConfig();
  return legacy ? [legacy] : [];
}

export async function getSystemNewsConfigs(): Promise<ActiveNewsConfig[]> {
  const environment = [
    process.env.MARKETAUX_API_KEY && { provider: "marketaux" as const, apiKey: process.env.MARKETAUX_API_KEY },
    process.env.GNEWS_API_KEY && { provider: "gnews" as const, apiKey: process.env.GNEWS_API_KEY },
    process.env.NEWS_API_KEY && { provider: "newsapi" as const, apiKey: process.env.NEWS_API_KEY },
    process.env.ALPHA_VANTAGE_API_KEY && { provider: "alpha_vantage" as const, apiKey: process.env.ALPHA_VANTAGE_API_KEY },
  ].filter((item): item is ActiveNewsConfig => Boolean(item));
  if (environment.length) return environment;
  const owner = await queryOne<{ id: string }>(
    `select id from public.users order by (email=$1) desc,created_at asc limit 1`,
    [process.env.DEFAULT_USER_EMAIL ?? ""],
  );
  if (owner) {
    const configs = await newsConfigsForUser(owner.id);
    if (configs.length) return configs;
  }
  const legacy = await getSystemNewsConfig();
  return legacy ? [legacy] : [];
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

/**
 * Cron-safe resolver. Deployment keys take priority. A local/personal install
 * may fall back to the configured owner's encrypted key so unattended news
 * monitoring does not silently stop after the browser session ends.
 */
export async function getSystemNewsConfig(): Promise<ActiveNewsConfig | null> {
  const environment = getEnvironmentNewsConfig();
  if (environment) return environment;
  const row = await queryOne<{ news_provider: string | null; news_api_key_encrypted: string | null }>(
    `select c.news_provider,c.news_api_key_encrypted
       from public.user_credentials c
       join public.users u on u.id=c.user_id
      where c.news_api_key_encrypted is not null
      order by (u.email=$1) desc,u.created_at asc
      limit 1`,
    [process.env.DEFAULT_USER_EMAIL ?? ""],
  );
  if (!row?.news_api_key_encrypted || !NEWS_PROVIDERS.has(row.news_provider as NewsProvider)) return null;
  return {
    provider: row.news_provider as NewsProvider,
    apiKey: decryptCredential(row.news_api_key_encrypted),
  };
}

function getEnvironmentNewsConfig(): ActiveNewsConfig | null {
  if (process.env.MARKETAUX_API_KEY) return { provider: "marketaux", apiKey: process.env.MARKETAUX_API_KEY };
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

  const row = await queryOne<{ ai_provider: string | null; ai_model: string | null; ai_api_key_encrypted: string | null }>(
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

  if (process.env.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      model: DEFAULT_MODEL_BY_PROVIDER.deepseek,
      apiKey: process.env.DEEPSEEK_API_KEY,
    };
  }

  // Fallback: an environment-owned model key keeps local deployments working
  // without storing a key for every user.
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: DEFAULT_MODEL_BY_PROVIDER.anthropic,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  return null;
}

/** Environment-first AI resolver with the same owner fallback as news cron. */
export async function getSystemAIConfig(): Promise<ActiveAIConfig | null> {
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      model: DEFAULT_MODEL_BY_PROVIDER.deepseek,
      apiKey: process.env.DEEPSEEK_API_KEY,
    };
  }
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
  const row = await queryOne<{
    ai_provider: string | null;
    ai_model: string | null;
    ai_api_key_encrypted: string | null;
  }>(
    `select c.ai_provider,c.ai_model,c.ai_api_key_encrypted
       from public.user_credentials c
       join public.users u on u.id=c.user_id
      where c.ai_api_key_encrypted is not null
      order by (u.email=$1) desc,u.created_at asc
      limit 1`,
    [process.env.DEFAULT_USER_EMAIL ?? ""],
  );
  if (!row?.ai_api_key_encrypted || !isAIProvider(row.ai_provider)) return null;
  return {
    provider: row.ai_provider,
    model: row.ai_model || DEFAULT_MODEL_BY_PROVIDER[row.ai_provider],
    apiKey: decryptCredential(row.ai_api_key_encrypted),
  };
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
