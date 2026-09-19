import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

const TOKEN_BYTES = 32;
const SESSION_DAYS = 30;

export function hashMobileToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{40,})$/i);
  return match?.[1] ?? null;
}

export async function createMobileSession(userId: string, deviceName?: string) {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await query(
    `insert into public.mobile_sessions(user_id,token_hash,device_name,expires_at)
     values($1,$2,$3,$4)`,
    [userId, hashMobileToken(token), (deviceName || "InvestoGenie mobile").slice(0, 120), expiresAt],
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function getMobileSessionUser(request: NextRequest): Promise<SessionUser | null> {
  return (await getMobileSession(request))?.user ?? null;
}

export async function getMobileSession(request: NextRequest): Promise<{
  sessionId: string;
  user: SessionUser;
} | null> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  const row = await queryOne<SessionUser & { session_id: string }>(
    `update public.mobile_sessions s
        set last_used_at=now()
       from public.users u
      where s.token_hash=$1 and s.user_id=u.id
        and s.revoked_at is null and s.expires_at > now()
      returning s.id session_id,u.id,u.email`,
    [hashMobileToken(token)],
  );
  return row ? { sessionId: row.session_id, user: { id: row.id, email: row.email } } : null;
}

export async function revokeMobileSession(request: NextRequest): Promise<boolean> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) return false;
  const rows = await query<{ id: string }>(
    `update public.mobile_sessions set revoked_at=now()
      where token_hash=$1 and revoked_at is null returning id`,
    [hashMobileToken(token)],
  );
  return rows.length > 0;
}
