// One-time, expiring sign-up invitations. The plaintext token is returned once
// to the issuing admin and never stored; redemption looks it up by SHA-256.
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { query, tx } from "@/lib/db";
import { hashToken } from "@/lib/passwordResetTokens";

export const INVITE_TTL_HOURS = 72;
const TOKEN_BYTES = 32;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeInviteEmail = (value: string | null | undefined): string | null => {
  const email = value?.trim().toLowerCase() ?? "";
  return email ? email : null;
};

export async function issueInvitation(createdBy: string, email: string | null, ttlHours = INVITE_TTL_HOURS) {
  const bound = normalizeInviteEmail(email);
  if (bound && !EMAIL.test(bound)) throw new Error("Enter a valid email address, or leave it blank.");
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await query(
    `insert into public.user_invitations (token_hash, email, created_by, expires_at) values ($1, $2, $3, $4)`,
    [hashToken(token), bound, createdBy, expiresAt],
  );
  return { token, expiresAt, email: bound };
}

export interface OpenInvitation { id: string; email: string | null; createdAt: string; expiresAt: string }

export function listOpenInvitations(): Promise<OpenInvitation[]> {
  return query<OpenInvitation>(
    `select id, email, to_json(created_at)#>>'{}' "createdAt", to_json(expires_at)#>>'{}' "expiresAt"
       from public.user_invitations
      where used_at is null and revoked_at is null and expires_at > now()
      order by created_at desc limit 50`,
  );
}

export async function revokeInvitation(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await query(`update public.user_invitations set revoked_at = now() where id = $1 and used_at is null`, [id]);
}

export type AcceptResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; reason: "invalid" | "email_mismatch" | "exists" };

/**
 * Create the account and consume the invitation atomically. The invitation row
 * is locked, so concurrent redemptions cannot both succeed, and it is consumed
 * only when the account is actually created (a mismatch or duplicate email
 * leaves it usable).
 */
export async function acceptInvitation(token: string, email: string, passwordHash: string): Promise<AcceptResult> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, reason: "invalid" };
  const normalized = normalizeInviteEmail(email);
  if (!normalized) return { ok: false, reason: "invalid" };
  return tx(async (client: PoolClient) => {
    const invite = await client.query<{ id: string; email: string | null }>(
      `select id, email from public.user_invitations
        where token_hash = $1 and used_at is null and revoked_at is null and expires_at > now()
        for update`,
      [hashToken(token)],
    );
    const row = invite.rows[0];
    if (!row) return { ok: false, reason: "invalid" } as const;
    if (row.email && row.email !== normalized) return { ok: false, reason: "email_mismatch" } as const;
    const existing = await client.query(`select 1 from public.users where lower(email) = $1`, [normalized]);
    if (existing.rowCount) return { ok: false, reason: "exists" } as const;
    const created = await client.query<{ id: string; email: string }>(
      `insert into public.users (email, password_hash) values ($1, $2) returning id, email`,
      [normalized, passwordHash],
    );
    const user = created.rows[0];
    await client.query(`update public.user_invitations set used_at = now(), used_by = $2 where id = $1`, [row.id, user.id]);
    return { ok: true, user } as const;
  });
}
