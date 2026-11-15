import { afterAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { claimEmailDigest, finishEmailDigest } from "@/lib/email-digest.server";

const TEST_DATE = "1990-01-03";
const userId = await query<{ id: string }>("select id::text from public.users order by created_at limit 1")
  .then((rows) => rows[0]?.id ?? null, () => null);

describe.skipIf(!userId)("email digest idempotency", () => {
  afterAll(async () => {
    await query("delete from public.email_digest_deliveries where user_id=$1 and market_date=$2", [userId, TEST_DATE]);
  });

  it("allows only one durable claim per user and market date", async () => {
    await query("delete from public.email_digest_deliveries where user_id=$1 and market_date=$2", [userId, TEST_DATE]);
    expect(await claimEmailDigest(userId!, TEST_DATE)).toBe(true);
    expect(await claimEmailDigest(userId!, TEST_DATE)).toBe(false);
    await finishEmailDigest(userId!, TEST_DATE, "SENT");
    expect(await claimEmailDigest(userId!, TEST_DATE)).toBe(false);
  });
});
