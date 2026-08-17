// Issue and redeem emailed password-reset tokens.
//
// The token is generated here, hashed, and only the hash is stored; the plaintext is returned
// once so the caller can put it in the email and is never persisted. Redemption therefore looks
// up by hash, which also means a wrong token costs one indexed lookup and leaks nothing.
import { randomBytes, createHash } from "node:crypto";
import { query, queryOne } from "@/lib/db";

/** 32 bytes of entropy — far beyond guessing through a form, still short enough for a URL. */
const TOKEN_BYTES = 32;

/** Long enough to fetch an email on a phone, short enough that a stale inbox is not a key. */
export const TOKEN_TTL_MINUTES = 30;

/** Cap on how many links may be requested per hour, so the flow cannot be used to spam. */
export const MAX_REQUESTS_PER_HOUR = 5;

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/**
 * Issues a token for `userId`, retiring any outstanding one first so only the newest link
 * works. Returns null if the hourly cap has already been reached.
 */
export async function issueResetToken(userId: string): Promise<IssuedToken | null> {
  const recent = await queryOne<{ count: string }>(
    `select count(*)::text from public.password_reset_tokens
      where user_id = $1 and created_at > now() - interval '1 hour'`,
    [userId],
  );
  if (Number(recent?.count ?? 0) >= MAX_REQUESTS_PER_HOUR) return null;

  // Retiring rather than deleting keeps the request history the throttle counts.
  await query(
    `update public.password_reset_tokens set used_at = now()
      where user_id = $1 and used_at is null`,
    [userId],
  );

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);
  await query(
    `insert into public.password_reset_tokens (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [userId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

export interface RedeemedToken {
  userId: string;
  email: string;
}

/**
 * Consumes a token and returns the account it belongs to, or null if it is unknown, already
 * used or expired. The update is the guard: marking `used_at` in the same statement that
 * selects the row means two concurrent redemptions cannot both succeed.
 */
export async function redeemResetToken(token: string): Promise<RedeemedToken | null> {
  if (!token) return null;
  const row = await queryOne<{ user_id: string; email: string }>(
    `update public.password_reset_tokens t
        set used_at = now()
       from public.users u
      where t.token_hash = $1
        and t.used_at is null
        and t.expires_at > now()
        and u.id = t.user_id
     returning t.user_id, u.email`,
    [hashToken(token)],
  );
  return row ? { userId: row.user_id, email: row.email } : null;
}

/** Whether a token is currently redeemable, without consuming it (used to render the form). */
export async function isResetTokenValid(token: string): Promise<boolean> {
  if (!token) return false;
  const row = await queryOne<{ id: string }>(
    `select id from public.password_reset_tokens
      where token_hash = $1 and used_at is null and expires_at > now()`,
    [hashToken(token)],
  );
  return Boolean(row);
}
