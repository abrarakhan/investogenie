"use server";

import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { encryptCredential, decryptCredential } from "@/lib/crypto/credentials";

export type AIProvider = "anthropic" | "openai";

export interface StoredCredentials {
  id: string;
  userId: string;
  // SMTP
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  // AI Keys (decrypted)
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  updatedAt: Date;
}

export interface CredentialsInput {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

/** Get decrypted credentials for the current user. */
export async function getUserCredentials(): Promise<StoredCredentials | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const result = await queryOne<{
    id: string;
    user_id: string;
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
    smtp_password_encrypted: string | null;
    anthropic_api_key_encrypted: string | null;
    openai_api_key_encrypted: string | null;
    updated_at: Date;
  }>(
    `select id, user_id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
            anthropic_api_key_encrypted, openai_api_key_encrypted, updated_at
     from public.user_credentials
     where user_id = $1`,
    [user.id],
  );

  if (!result) return null;

  return {
    id: result.id,
    userId: result.user_id,
    smtpHost: result.smtp_host,
    smtpPort: result.smtp_port,
    smtpUser: result.smtp_user,
    anthropicApiKey: result.anthropic_api_key_encrypted
      ? decryptCredential(result.anthropic_api_key_encrypted)
      : null,
    openaiApiKey: result.openai_api_key_encrypted
      ? decryptCredential(result.openai_api_key_encrypted)
      : null,
    updatedAt: result.updated_at,
  };
}

/** Update or create credentials for the current user. */
export async function updateCredentials(input: CredentialsInput): Promise<StoredCredentials> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");

  const existing = await getUserCredentials();

  const encryptedAnthropic = input.anthropicApiKey
    ? encryptCredential(input.anthropicApiKey)
    : undefined;
  const encryptedOpenai = input.openaiApiKey ? encryptCredential(input.openaiApiKey) : undefined;
  const encryptedSmtpPassword = input.smtpPassword
    ? encryptCredential(input.smtpPassword)
    : undefined;

  if (!existing) {
    // Create new
    const result = await queryOne<{
      id: string;
      user_id: string;
      smtp_host: string | null;
      smtp_port: number | null;
      smtp_user: string | null;
      smtp_password_encrypted: string | null;
      anthropic_api_key_encrypted: string | null;
      openai_api_key_encrypted: string | null;
      updated_at: Date;
    }>(
      `insert into public.user_credentials (user_id, smtp_host, smtp_port, smtp_user,
        smtp_password_encrypted, anthropic_api_key_encrypted, openai_api_key_encrypted)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        user.id,
        input.smtpHost || null,
        input.smtpPort || null,
        input.smtpUser || null,
        encryptedSmtpPassword || null,
        encryptedAnthropic || null,
        encryptedOpenai || null,
      ],
    );

    if (!result) throw new Error("Failed to create credentials");
    return mapCredentials(result);
  }

  // Update existing
  const result = await queryOne<{
    id: string;
    user_id: string;
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
    smtp_password_encrypted: string | null;
    anthropic_api_key_encrypted: string | null;
    openai_api_key_encrypted: string | null;
    updated_at: Date;
  }>(
    `update public.user_credentials
     set smtp_host = coalesce($2, smtp_host),
         smtp_port = coalesce($3, smtp_port),
         smtp_user = coalesce($4, smtp_user),
         smtp_password_encrypted = coalesce($5, smtp_password_encrypted),
         anthropic_api_key_encrypted = coalesce($6, anthropic_api_key_encrypted),
         openai_api_key_encrypted = coalesce($7, openai_api_key_encrypted),
         updated_at = now()
     where user_id = $1
     returning *`,
    [
      user.id,
      input.smtpHost ?? null,
      input.smtpPort ?? null,
      input.smtpUser ?? null,
      encryptedSmtpPassword ?? null,
      encryptedAnthropic ?? null,
      encryptedOpenai ?? null,
    ],
  );

  if (!result) throw new Error("Failed to update credentials");
  return mapCredentials(result);
}

/** Clear a specific credential. */
export async function clearCredential(field: keyof CredentialsInput): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");

  const updateMap: Record<string, string> = {
    smtpPassword: "smtp_password_encrypted",
    anthropicApiKey: "anthropic_api_key_encrypted",
    openaiApiKey: "openai_api_key_encrypted",
  };

  const columnName = updateMap[field];
  if (!columnName) throw new Error(`Cannot clear field: ${field}`);

  await query(
    `update public.user_credentials
     set ${columnName} = null, updated_at = now()
     where user_id = $1`,
    [user.id],
  );
}

function mapCredentials(result: {
  id: string;
  user_id: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password_encrypted: string | null;
  anthropic_api_key_encrypted: string | null;
  openai_api_key_encrypted: string | null;
  updated_at: Date;
}): StoredCredentials {
  return {
    id: result.id,
    userId: result.user_id,
    smtpHost: result.smtp_host,
    smtpPort: result.smtp_port,
    smtpUser: result.smtp_user,
    anthropicApiKey: result.anthropic_api_key_encrypted
      ? decryptCredential(result.anthropic_api_key_encrypted)
      : null,
    openaiApiKey: result.openai_api_key_encrypted
      ? decryptCredential(result.openai_api_key_encrypted)
      : null,
    updatedAt: result.updated_at,
  };
}

/** Get a specific AI provider API key for use by the application. */
export async function getAIProviderKey(provider: AIProvider): Promise<string | null> {
  const creds = await getUserCredentials();
  if (!creds) return null;

  if (provider === "anthropic") return creds.anthropicApiKey;
  if (provider === "openai") return creds.openaiApiKey;

  return null;
}

/** Get SMTP configuration for email sending. Prefers DB credentials, falls back to env. */
export async function getSMTPConfig(): Promise<{
  host: string;
  port: number;
  user: string;
  password: string;
} | null> {
  // Try to get from database first
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

  // Fall back to environment variables
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
