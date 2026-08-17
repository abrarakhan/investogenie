import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { query, queryOne } from "@/lib/db";
import {
  issueResetToken,
  redeemResetToken,
  isResetTokenValid,
  hashToken,
  MAX_REQUESTS_PER_HOUR,
} from "@/lib/passwordResetTokens";

// Exercised against the real table. A dedicated row keeps the developer's own account and any
// live tokens out of it; everything created here is removed afterwards.
const TEST_EMAIL = "pwreset.test@invalid.local";
let userId: string;

async function ensureTestUser(): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    `select id from public.users where email = $1`, [TEST_EMAIL]);
  if (existing) return existing.id;
  const created = await queryOne<{ id: string }>(
    `insert into public.users (email, password_hash) values ($1, $2) returning id`,
    [TEST_EMAIL, "$2b$10$notarealhashnotarealhashnotarealhashnotarealhashnotar"],
  );
  return created!.id;
}

beforeEach(async () => {
  userId = await ensureTestUser();
  await query(`delete from public.password_reset_tokens where user_id = $1`, [userId]);
});

afterAll(async () => {
  const row = await queryOne<{ id: string }>(
    `select id from public.users where email = $1`, [TEST_EMAIL]);
  if (row) await query(`delete from public.users where id = $1`, [row.id]);
});

describe("issueResetToken", () => {
  it("stores only the hash, never the token itself", async () => {
    const issued = await issueResetToken(userId);
    expect(issued).not.toBeNull();
    const stored = await queryOne<{ token_hash: string }>(
      `select token_hash from public.password_reset_tokens where user_id = $1`, [userId]);
    expect(stored!.token_hash).toBe(hashToken(issued!.token));
    expect(stored!.token_hash).not.toBe(issued!.token);
  });

  it("issues a distinct token each time", async () => {
    const a = await issueResetToken(userId);
    const b = await issueResetToken(userId);
    expect(a!.token).not.toBe(b!.token);
  });

  it("retires the previous token so only the newest link works", async () => {
    const first = await issueResetToken(userId);
    await issueResetToken(userId);
    expect(await isResetTokenValid(first!.token)).toBe(false);
  });

  it("stops issuing once the hourly cap is reached", async () => {
    for (let i = 0; i < MAX_REQUESTS_PER_HOUR; i++) {
      expect(await issueResetToken(userId)).not.toBeNull();
    }
    expect(await issueResetToken(userId)).toBeNull();
  });
});

describe("redeemResetToken", () => {
  it("returns the owning account for a good token", async () => {
    const issued = await issueResetToken(userId);
    const redeemed = await redeemResetToken(issued!.token);
    expect(redeemed).toEqual({ userId, email: TEST_EMAIL });
  });

  it("cannot be redeemed twice", async () => {
    const issued = await issueResetToken(userId);
    expect(await redeemResetToken(issued!.token)).not.toBeNull();
    expect(await redeemResetToken(issued!.token)).toBeNull();
  });

  it("rejects an unknown or empty token", async () => {
    expect(await redeemResetToken("")).toBeNull();
    expect(await redeemResetToken("f".repeat(64))).toBeNull();
  });

  it("rejects an expired token", async () => {
    const issued = await issueResetToken(userId);
    await query(
      `update public.password_reset_tokens set expires_at = now() - interval '1 minute'
        where token_hash = $1`,
      [hashToken(issued!.token)],
    );
    expect(await isResetTokenValid(issued!.token)).toBe(false);
    expect(await redeemResetToken(issued!.token)).toBeNull();
  });

  it("checking validity does not consume the token", async () => {
    const issued = await issueResetToken(userId);
    expect(await isResetTokenValid(issued!.token)).toBe(true);
    expect(await isResetTokenValid(issued!.token)).toBe(true);
    expect(await redeemResetToken(issued!.token)).not.toBeNull();
  });
});
