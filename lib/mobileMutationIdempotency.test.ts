import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { claimMobileMutation, completeMobileMutation, mobileIdempotencyKey, mutationRequestHash } from "@/lib/mobileMutationIdempotency";

describe("mobile mutation idempotency", () => {
  it("accepts UUID keys and rejects missing or malformed keys", () => {
    const request = new Request("https://example.test", { headers: { "Idempotency-Key": "11111111-1111-4111-8111-111111111111" } });
    expect(mobileIdempotencyKey(request)).toBe("11111111-1111-4111-8111-111111111111");
    expect(() => mobileIdempotencyKey(new Request("https://example.test"))).toThrow(/required/);
    expect(() => mobileIdempotencyKey(new Request("https://example.test", { headers: { "Idempotency-Key": "same-request" } }))).toThrow(/required/);
  });

  it("binds a key to both its operation and request body", () => {
    const first = mutationRequestHash("CREATE_TRADE", { quantity: 10, price: 100 });
    expect(first).toBe(mutationRequestHash("CREATE_TRADE", { quantity: 10, price: 100 }));
    expect(first).not.toBe(mutationRequestHash("CREATE_TRADE", { quantity: 11, price: 100 }));
    expect(first).not.toBe(mutationRequestHash("CREATE_SALE", { quantity: 10, price: 100 }));
  });

  it("has database uniqueness for both email dates and mobile keys", () => {
    const migration = readFileSync("db/migrations/0079_delivery_and_mobile_idempotency.sql", "utf8");
    expect(migration).toContain("primary key (user_id, market_date)");
    expect(migration).toContain("primary key (user_id, idempotency_key)");
  });
});

const reachable = await query<{ id: string }>("select id::text from public.users order by created_at limit 1")
  .then((rows) => rows[0]?.id ?? null, () => null);
const integrationKey = crypto.randomUUID();

describe.skipIf(!reachable)("mobile mutation idempotency database", () => {
  afterAll(async () => {
    await query("delete from public.mobile_mutation_idempotency where user_id=$1 and idempotency_key=$2", [reachable, integrationKey]);
  });

  it("replays the completed response and refuses a different payload", async () => {
    const hash = mutationRequestHash("CREATE_TRADE", { quantity: 10 });
    expect(await claimMobileMutation(reachable!, integrationKey, "CREATE_TRADE", hash)).toBeNull();
    await completeMobileMutation(reachable!, integrationKey, { status: 201, body: { id: "trade-1" } });
    expect(await claimMobileMutation(reachable!, integrationKey, "CREATE_TRADE", hash))
      .toEqual({ status: 201, body: { id: "trade-1" } });
    await expect(claimMobileMutation(reachable!, integrationKey, "CREATE_TRADE",
      mutationRequestHash("CREATE_TRADE", { quantity: 11 }))).rejects.toThrow(/different mutation/);
  });
});
