import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { createMobileSession } from "@/lib/mobileAuth";
import { captureExecutionPlans, loadExecutionPlan } from "@/lib/swingExecutionPlans";
import * as alertsRoute from "@/app/api/v1/mobile/alerts/route";
import * as watchlistsRoute from "@/app/api/v1/mobile/watchlists/route";

const schemaReady = await query<{ ready: boolean }>(
  `select to_regclass('public.mobile_alert_preferences') is not null
       and to_regclass('public.mobile_sessions') is not null
       and to_regclass('public.watchlist_items') is not null as ready`,
).then((rows) => rows[0]?.ready === true, () => false);

const ids = { a: crypto.randomUUID(), b: crypto.randomUUID() };
const emailSuffix = crypto.randomUUID();
let tokenA = "";
let tokenB = "";
let ticker = "";
let assetId = "";
let watchItemId = "";

function request(path: string, token: string, init: { method?: string; body?: BodyInit; headers?: HeadersInit } = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    body: init.body,
    headers,
  });
}

describe.skipIf(!schemaReady)("database-backed two-user mobile isolation", () => {
  beforeAll(async () => {
    const assets = await query<{ id: string; ticker: string }>(
      `select id,ticker from public.assets
        where country='IN' and exchange='NSE' and is_active
        order by ticker limit 1`,
    );
    ticker = assets[0]?.ticker ?? "";
    assetId = assets[0]?.id ?? "";
    if (!ticker) throw new Error("Two-user isolation test needs one active NSE asset");
    await query(
      `insert into public.users(id,email,password_hash) values
       ($1,$3,'test-account-not-for-login'),($2,$4,'test-account-not-for-login')`,
      [ids.a, ids.b, `isolation-a-${emailSuffix}@example.test`, `isolation-b-${emailSuffix}@example.test`],
    );
    tokenA = (await createMobileSession(ids.a, "isolation-a")).token;
    tokenB = (await createMobileSession(ids.b, "isolation-b")).token;
  });

  afterAll(async () => {
    await query("delete from public.users where id = any($1::uuid[])", [[ids.a, ids.b]]).catch(() => undefined);
  });

  it("keeps alert preferences independent for two authenticated users", async () => {
    const changed = await alertsRoute.PATCH(request("/api/v1/mobile/alerts", tokenA, {
      method: "PATCH", body: JSON.stringify({ executionReady: false, ledgerRiskAlerts: false }),
    }));
    expect(changed.status).toBe(200);

    const [aResponse, bResponse] = await Promise.all([
      alertsRoute.GET(request("/api/v1/mobile/alerts", tokenA)),
      alertsRoute.GET(request("/api/v1/mobile/alerts", tokenB)),
    ]);
    expect((await aResponse.json()).preferences).toMatchObject({ executionReady: false, ledgerRiskAlerts: false });
    expect((await bResponse.json()).preferences).toMatchObject({ executionReady: true, ledgerRiskAlerts: true });
  });

  it("does not expose or delete another user's watchlist item", async () => {
    const added = await watchlistsRoute.POST(request("/api/v1/mobile/watchlists", tokenA, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ market: "IN", ticker }),
    }));
    expect(added.status).toBe(201);
    watchItemId = (await added.json()).id;

    const [aList, bList] = await Promise.all([
      watchlistsRoute.GET(request("/api/v1/mobile/watchlists?market=IN", tokenA)),
      watchlistsRoute.GET(request("/api/v1/mobile/watchlists?market=IN", tokenB)),
    ]);
    expect((await aList.json()).items.some((item: { id: string }) => item.id === watchItemId)).toBe(true);
    expect((await bList.json()).items).toEqual([]);

    const attemptedDelete = await watchlistsRoute.DELETE(request(
      `/api/v1/mobile/watchlists?id=${watchItemId}`,
      tokenB,
      { method: "DELETE", headers: { "Idempotency-Key": crypto.randomUUID() } },
    ));
    expect(attemptedDelete.status).toBe(200);
    const hiddenFromOtherUser = await query<{ id: string }>(
      "select id from public.watchlist_items where id=$1 and user_id=$2",
      [watchItemId, ids.a],
    );
    expect(hiddenFromOtherUser).toHaveLength(1);
    const ownerRows = await query<{ id: string }>(
      "select id from public.watchlist_items where id=$1 and user_id=$2",
      [watchItemId, ids.a],
    );
    expect(ownerRows).toHaveLength(1);
  });

  it("does not let another user load an immutable execution plan", async () => {
    const plans = await captureExecutionPlans(ids.a, "IN", "2026-11-21", [{
      assetId,
      strategyKey: "STRONG_SWING",
      status: "EXECUTION_READY",
      entry: 100,
      target: 112,
      stop: 94,
      trail: 95,
      atr: 4,
      expectedDays: 10,
      signalAsOf: "2026-11-20",
      score: 90,
      snapshot: { executionModelVersion: "isolation-test" },
    }], 1.5);
    const planId = plans.get(`STRONG_SWING:EXECUTION_READY:${assetId}`);
    expect(planId).toBeTruthy();
    expect((await loadExecutionPlan(ids.a, planId!))?.assetId).toBe(assetId);
    expect(await loadExecutionPlan(ids.b, planId!)).toBeNull();
  });
});
