import { SignJWT, jwtVerify } from "jose";
import { decryptCredential, encryptCredential } from "@/lib/crypto/credentials";
import { query, queryOne } from "@/lib/db";

export const BREEZE_CONNECT_COOKIE = "ig_breeze_connect";
export const BREEZE_CONNECT_MAX_AGE = 10 * 60;

const stateSecret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me-0123456789",
);

export async function createBreezeConnectState(userId: string): Promise<string> {
  return new SignJWT({ purpose: "breeze-connect" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("investogenie")
    .setAudience("breeze-callback")
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${BREEZE_CONNECT_MAX_AGE}s`)
    .sign(stateSecret);
}

export async function readBreezeConnectState(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, stateSecret, {
      issuer: "investogenie",
      audience: "breeze-callback",
    });
    return payload.purpose === "breeze-connect" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function buildBreezeLoginUrl(apiKey: string): string {
  const url = new URL("https://api.icicidirect.com/apiuser/login");
  url.searchParams.set("api_key", apiKey);
  return url.toString();
}

export function extractBreezeApiSession(params: URLSearchParams): string | null {
  const value = ["apisession", "API_Session", "api_session", "session_token"]
    .map((key) => params.get(key)?.trim())
    .find(Boolean);
  return value && value.length <= 4096 ? value : null;
}

export async function getBreezeApiKey(userId: string): Promise<string | null> {
  const row = await queryOne<{ breeze_api_key_encrypted: string | null }>(
    "select breeze_api_key_encrypted from public.user_credentials where user_id=$1",
    [userId],
  );
  return row?.breeze_api_key_encrypted
    ? decryptCredential(row.breeze_api_key_encrypted)
    : null;
}

export async function saveBreezeApiSession(userId: string, apiSession: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update public.user_credentials
        set breeze_session_token_encrypted=$2,breeze_session_updated_at=now(),updated_at=now()
      where user_id=$1 and breeze_api_key_encrypted is not null
      returning id`,
    [userId, encryptCredential(apiSession)],
  );
  return rows.length === 1;
}
