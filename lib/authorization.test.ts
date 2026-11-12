/**
 * Authorization matrix for every route handler and Server Action.
 *
 * Two layers:
 *  1. Inventory: every route.ts and every export of a "use server" module must
 *     be classified below. A new route or action fails this test until someone
 *     decides who may call it.
 *  2. Behaviour: anonymous, ordinary-user and admin calls against the guards,
 *     with the database and Next request context mocked. Denied calls must be
 *     rejected before any downstream work.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSessionUser: vi.fn(async () => session.user),
}));
vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  tx: vi.fn(async () => { throw new Error("tx not expected in authorization tests"); }),
  pool: { connect: vi.fn(), end: vi.fn(), query: vi.fn(async () => ({ rows: [] })) },
  getDatabaseUrl: () => "postgres://test",
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })),
}));
vi.mock("next/navigation", () => ({
  // Real redirect() errors carry a NEXT_REDIRECT digest that actions re-throw.
  redirect: vi.fn((to: string) => { throw Object.assign(new Error(`REDIRECT:${to}`), { digest: `NEXT_REDIRECT;replace;${to};307;` }); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/ingest/cronLog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ingest/cronLog")>()),
  logCronRun: vi.fn(async () => {}),
}));

const ROOT = join(__dirname, "..");
const USER: SessionUser = { id: "00000000-0000-4000-8000-000000000001", email: "user@example.test", role: "USER" };
const ADMIN: SessionUser = { id: "00000000-0000-4000-8000-000000000002", email: "owner@example.test", role: "ADMIN" };

function walk(dir: string, match: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, match, out);
    else if (match(path)) out.push(relative(ROOT, path));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1a. Route inventory
// ---------------------------------------------------------------------------
type RoutePolicy =
  | "public"        // deliberately anonymous (OAuth state-checked callbacks, redirects, mobile login)
  | "session"       // signed-in web user
  | "admin"         // admin web session only
  | "cron-or-admin" // CRON_SECRET bearer, or an admin session
  | "cron"          // CRON_SECRET bearer only
  | "mobile";       // mobile bearer session

const ROUTES: Record<string, RoutePolicy> = {
  "app/api/assets/search/route.ts": "session",
  "app/api/backfill/populate/route.ts": "admin",
  "app/api/backfill/requeue-failed/route.ts": "admin",
  "app/api/backfill/run/route.ts": "cron-or-admin",
  "app/api/backfill/status/route.ts": "admin",
  "app/api/breeze/callback/route.ts": "public", // authenticated by the signed connect-state cookie
  "app/api/breeze/connect/route.ts": "session",
  "app/api/breeze/order-preview/route.ts": "session", // read-only, from the caller's own Breeze session
  "app/api/breeze/refresh-quotes/route.ts": "session", // non-admins are skipped: see below
  "app/api/browser-notifications/route.ts": "session",
  "app/api/cron/backfill-bse/route.ts": "cron",
  "app/api/cron/backfill-nse/route.ts": "cron",
  "app/api/cron/backfill-us-expand/route.ts": "cron",
  "app/api/cron/backfill-us/route.ts": "cron",
  "app/api/cron/breeze-auto-buy/route.ts": "cron",
  "app/api/cron/forward-test/route.ts": "cron",
  "app/api/cron/gmail-disclosures/route.ts": "cron",
  "app/api/cron/mobile-alerts/route.ts": "cron",
  "app/api/cron/news-intelligence/route.ts": "cron",
  "app/api/cron/refresh-quotes/route.ts": "cron",
  "app/api/cron/refresh-screener/route.ts": "cron",
  "app/api/cron/scan/route.ts": "cron",
  "app/api/cron/send-email-digest/route.ts": "cron",
  "app/api/gmail/callback/route.ts": "session",
  "app/api/gmail/connect/route.ts": "session",
  "app/api/market-overview/candles/route.ts": "session",
  "app/api/market-overview/intraday/route.ts": "session",
  "app/api/market-overview/series/route.ts": "session",
  "app/api/screener/backtest/route.ts": "session",
  "app/api/screener/route.ts": "session",
  "app/api/v1/mobile/assets/search/route.ts": "mobile",
  "app/api/v1/mobile/auth/login/route.ts": "public",
  "app/api/v1/mobile/auth/logout/route.ts": "public", // revokes only the presented token; no-op without one
  "app/api/v1/mobile/candles/route.ts": "mobile",
  "app/api/v1/mobile/me/route.ts": "mobile",
  "app/api/v1/mobile/news-swing/route.ts": "mobile",
  "app/api/v1/mobile/push-token/route.ts": "mobile",
  "app/api/v1/mobile/screens/[screen]/route.ts": "mobile",
  "app/api/v1/mobile/screens/route.ts": "mobile",
  "app/api/v1/mobile/strong-swing/route.ts": "mobile",
  "app/api/v1/mobile/trade-ledger/[tradeId]/route.ts": "mobile",
  "app/api/v1/mobile/trade-ledger/[tradeId]/sales/[saleId]/route.ts": "mobile",
  "app/api/v1/mobile/trade-ledger/[tradeId]/sales/route.ts": "mobile",
  "app/api/v1/mobile/trade-ledger/route.ts": "mobile",
  "app/auth/confirm/route.ts": "public", // redirects to /login only
  "app/b/route.ts": "public", // re-export of the Breeze callback
  "app/portfolio/fund-mapping/export/route.ts": "session",
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Handler = (request: NextRequest, context: unknown) => Promise<Response> | Response;
const routeContext = { params: Promise.resolve({ tradeId: "t", saleId: "s", screen: "strong-swing" }) };

async function call(handler: Handler, method: string, init: { auth?: string; body?: unknown } = {}): Promise<Response | string> {
  const request = new NextRequest(`http://localhost/test?market=IN&q=AB&ticker=RELIANCE&tickers=TCS`, {
    method,
    headers: { "content-type": "application/json", ...(init.auth ? { authorization: init.auth } : {}) },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(init.body ?? { assetIds: [] }),
  });
  try {
    return await handler(request, routeContext);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const isDenied = (result: Response | string): boolean => typeof result === "string"
  ? result.startsWith("REDIRECT:/login") || result === "NOT_FOUND"
  : [401, 403].includes(result.status) || ([302, 303, 307, 308].includes(result.status)
    && /\/login|\/settings|invalid_state|not_signed_in/.test(result.headers.get("location") ?? ""));

describe("route inventory", () => {
  it("classifies every route handler", () => {
    const routes = walk(join(ROOT, "app"), (path) => path.endsWith("route.ts")).sort();
    expect(routes.filter((route) => !(route in ROUTES))).toEqual([]);
    expect(Object.keys(ROUTES).filter((route) => !routes.includes(route))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1b. Server Action inventory
// ---------------------------------------------------------------------------
type ActionPolicy = "public-auth" | "session" | "admin";

/** Every export of every "use server" module. Each is a browser-callable endpoint. */
const ACTIONS: Record<string, Record<string, ActionPolicy>> = {
  "app/login/actions.ts": {
    login: "public-auth", signup: "public-auth", isPasswordResetEnabled: "public-auth", resetPassword: "public-auth",
    requestPasswordResetEmail: "public-auth", completePasswordReset: "public-auth", signout: "public-auth",
  },
  "app/settings/actions.ts": { saveSwingSettings: "session", resetSwingSettings: "session", saveBreezeAutoBuySettings: "session" },
  "app/settings/invite-actions.ts": { createInvitation: "admin", revokeInvitationAction: "admin" },
  "app/terminal/in/cas/actions.ts": { importCasStatement: "session", importAmcDisclosure: "session" },
  "app/terminal/[market]/trade-ledger/pendingOrderActions.ts": {
    createPendingBuyStop: "session", fillPendingBuyStop: "session", cancelPendingBuyStop: "session",
  },
  "app/terminal/[market]/trade-ledger/actions.ts": {
    addSwingTrade: "session", updateSwingTrade: "session", confirmSwingTradeGtt: "session",
    recordSwingTradeSale: "session", updateSwingTradeSale: "session", deleteSwingTrade: "session",
  },
  "app/terminal/[market]/adaptive-allocation/actions.ts": { saveAdaptiveStrategy: "session", deleteAdaptiveStrategy: "session" },
  "app/terminal/[market]/news-swing/actions.ts": { refreshNewsSwing: "admin" },
  "app/portfolio/fund-mapping/gmail-actions.ts": {
    scanGmailDisclosureInbox: "session", saveGmailOAuthCredentials: "session", saveGmailAutoImportSettings: "session",
    clearGmailCasPassword: "session", disconnectGmailDisclosureInbox: "session", ignoreGmailDisclosure: "session",
    importGmailDisclosure: "session",
  },
  "app/portfolio/fund-mapping/actions.ts": {
    acceptFundSuggestion: "session", rejectFundSuggestion: "session", unlinkFundMapping: "session", autoAcceptIsinMatches: "session",
  },
  "lib/email-actions.ts": { getEmailPreferences: "session", updateEmailPreferences: "session" },
  "lib/screener-actions.ts": {
    addToWatchlistById: "session", parseScreenIntent: "session", listSavedScreens: "session",
    saveScreen: "session", renameScreen: "session", deleteScreen: "session",
  },
  "lib/long-term-actions.ts": { getLongTermCandidates: "session" },
  "lib/candidate-group-actions.ts": { loadCandidateGroup: "session" },
  "lib/credentials-actions.ts": {
    getUserCredentials: "session", updateCredentials: "session", clearCredential: "session",
    getUserNewsProviders: "session", saveNewsProvider: "session", removeNewsProvider: "session",
  },
  "lib/dashboard-actions.ts": { ensureScaffold: "session", addToWatchlist: "session", removeWatchlistItem: "session", recordTrade: "session" },
};

const USE_SERVER = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["'];?/;
const AUTH_CALL = /\b(getSessionUser|ensureScaffold|requireUser|requireAdminAction|getMobileSessionUser)\s*\(/;

function exportedFunctions(source: string): Array<{ name: string; body: string }> {
  const matches = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)];
  return matches.map((match, index) => ({
    name: match[1],
    body: source.slice(match.index, matches[index + 1]?.index ?? source.length),
  }));
}

describe("server action inventory", () => {
  const files = walk(ROOT, (path) => /\.(ts|tsx)$/.test(path) && !/node_modules|\.next|mobile\//.test(path))
    .filter((path) => (path.startsWith("app/") || path.startsWith("lib/") || path.startsWith("components/"))
      && USE_SERVER.test(readFileSync(join(ROOT, path), "utf8")))
    .sort();

  it("classifies every exported Server Action", () => {
    const found = Object.fromEntries(files.map((file) => [
      file, exportedFunctions(readFileSync(join(ROOT, file), "utf8")).map((fn) => fn.name).sort(),
    ]));
    const expected = Object.fromEntries(Object.entries(ACTIONS).map(([file, names]) => [file, Object.keys(names).sort()]));
    expect(found).toEqual(expected);
  });

  it("re-checks the session inside every non-public action", () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const fn of exportedFunctions(readFileSync(join(ROOT, file), "utf8"))) {
        if (ACTIONS[file]?.[fn.name] !== "public-auth" && !AUTH_CALL.test(fn.body)) missing.push(`${file}#${fn.name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("never exports secret resolvers from a Server Action module", () => {
    const secretResolvers = /^(getSystem\w*Config|getActive\w*Config|getSMTPConfig|newsConfigsForUser|getEnabledEmailPreferences|sendEmailDigest)$/;
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(exportedFunctions(source).map((fn) => fn.name).filter((name) => secretResolvers.test(name)), file).toEqual([]);
      // Re-exports would also register them as actions.
      expect(source, file).not.toMatch(/export\s*\{[^}]*\b(getSystem\w*Config|getSMTPConfig|sendEmailDigest)\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Behaviour
// ---------------------------------------------------------------------------
beforeEach(async () => {
  session.user = null;
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.TRUSTED_PROXY_IP_HEADER;
  (await import("@/lib/rateLimit")).resetRateLimits();
});

describe("route handlers: anonymous and wrong-credential callers are rejected", () => {
  for (const [file, policy] of Object.entries(ROUTES)) {
    if (policy === "public") continue;
    it(`${file} (${policy})`, async () => {
      const mod = await import(/* @vite-ignore */ join(ROOT, file)) as Record<string, Handler>;
      const methods = METHODS.filter((method) => typeof mod[method] === "function");
      expect(methods.length, file).toBeGreaterThan(0);
      for (const method of methods) {
        session.user = null;
        expect(isDenied(await call(mod[method], method)), `${method} anonymous`).toBe(true);
        if (policy === "cron" || policy === "cron-or-admin") {
          expect(isDenied(await call(mod[method], method, { auth: "Bearer wrong" })), `${method} bad secret`).toBe(true);
          session.user = USER;
          expect(isDenied(await call(mod[method], method)), `${method} ordinary user`).toBe(true);
        }
        if (policy === "admin") {
          session.user = USER;
          const result = await call(mod[method], method);
          expect(result instanceof Response && result.status, `${method} ordinary user`).toBe(403);
        }
        if (policy === "mobile") {
          // A web session is not a mobile bearer token.
          session.user = ADMIN;
          expect(isDenied(await call(mod[method], method)), `${method} web session`).toBe(true);
        }
      }
    });
  }
});

describe("route handlers: role-specific behaviour", () => {
  it("lets an admin past the admin route guard", async () => {
    const { requireApiAdmin } = await import("@/lib/apiGuards");
    session.user = ADMIN;
    expect((await requireApiAdmin()).user?.id).toBe(ADMIN.id);
    session.user = USER;
    expect((await requireApiAdmin()).response?.status).toBe(403);
  });

  it("never lets an ordinary user feed the shared quote table from Breeze", async () => {
    const { POST } = await import("@/app/api/breeze/refresh-quotes/route");
    session.user = USER;
    const response = await POST(new NextRequest("http://localhost/api/breeze/refresh-quotes", {
      method: "POST", body: JSON.stringify({ assetIds: ["00000000-0000-4000-8000-0000000000aa"] }),
    }));
    expect(await response.json()).toMatchObject({ skipped: true, reason: "owner_only", updated: 0 });
  });

  it("rate limits the multi-year backtest per user", async () => {
    const { POST } = await import("@/app/api/screener/backtest/route");
    session.user = USER;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await POST(new NextRequest("http://localhost/api/screener/backtest", { method: "POST", body: "not json" }))).status);
    }
    expect(statuses.slice(0, 5).every((status) => status !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
    // Another user has an independent budget.
    session.user = { ...USER, id: "00000000-0000-4000-8000-000000000003" };
    expect((await POST(new NextRequest("http://localhost/api/screener/backtest", { method: "POST", body: "not json" }))).status).not.toBe(429);
  });
});

describe("server actions: role-specific behaviour", () => {
  it("restricts shared news refresh to admins", async () => {
    const { refreshNewsSwing } = await import("@/app/terminal/[market]/news-swing/actions");
    const form = new FormData();
    form.set("market", "IN");
    session.user = null;
    expect((await refreshNewsSwing({ ok: false, message: "" }, form)).ok).toBe(false);
    session.user = USER;
    expect(await refreshNewsSwing({ ok: false, message: "" }, form)).toEqual({ ok: false, message: "Shared news refresh is limited to the owner." });
  });

  it("restricts invitations to admins", async () => {
    const { createInvitation, revokeInvitationAction } = await import("@/app/settings/invite-actions");
    session.user = USER;
    expect((await createInvitation({}, new FormData())).error).toMatch(/owner/);
    await expect(revokeInvitationAction(new FormData())).rejects.toThrow(/owner/);
    session.user = null;
    expect((await createInvitation({}, new FormData())).error).toMatch(/Not signed in/);
  });

  it("refuses sign-up without a valid invitation", async () => {
    const { signup } = await import("@/app/login/actions");
    const form = new FormData();
    form.set("email", "new@example.test");
    form.set("password", "long-enough");
    expect((await signup({}, form)).error).toMatch(/invitation only/);
    form.set("invite", "not-a-token");
    expect((await signup({}, form)).error).toMatch(/invalid, already used/);
  });

  it("requires a session for the published long-term action", async () => {
    const { getLongTermCandidates } = await import("@/lib/long-term-actions");
    session.user = null;
    await expect(getLongTermCandidates({ market: "IN" } as Parameters<typeof getLongTermCandidates>[0])).rejects.toThrow(/Not signed in/);
  });

  it("requires a session and a deferrable group for on-demand candidate cards", async () => {
    const { loadCandidateGroup } = await import("@/lib/candidate-group-actions");
    session.user = null;
    expect(await loadCandidateGroup("strong", "IN", "WATCHLIST")).toMatchObject({ ok: false, error: "Not signed in", items: [] });
    session.user = USER;
    // Buyable groups always ship with the page and cannot be requested here.
    expect(await loadCandidateGroup("strong", "IN", "EXECUTION_READY")).toMatchObject({ ok: false, error: "Unknown group" });
    expect(await loadCandidateGroup("armed", "IN", "BUY_ZONE")).toMatchObject({ ok: false, error: "Unknown group" });
    expect(await loadCandidateGroup("nope" as never, "IN", "WATCHLIST")).toMatchObject({ ok: false, error: "Unknown group" });
    expect(await loadCandidateGroup("strong", "XX", "WATCHLIST")).toMatchObject({ ok: false, error: "Unknown group" });
  });

  it("authenticates CAS import before reading the upload", async () => {
    const { importCasStatement } = await import("@/app/terminal/in/cas/actions");
    session.user = null;
    await expect(importCasStatement(new FormData())).rejects.toThrow("REDIRECT:/login");
  });
});

describe("canonical system owner", () => {
  it("reads shared sources from the designated owner, never the oldest admin", () => {
    for (const file of ["lib/credentials.server.ts", "workers/breeze_market_daemon.py"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).toMatch(/is_system_owner/);
      expect(source, file).not.toMatch(/role\s*=\s*'ADMIN'/);
      expect(source, file).not.toMatch(/order by \(u?\.?email\s*=/);
    }
  });
});

describe("page guards and deployment keys", () => {
  it("sends anonymous visitors to login and hides admin pages from ordinary users", async () => {
    const { requireAdminPage } = await import("@/lib/authz");
    session.user = null;
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/login");
    session.user = USER;
    await expect(requireAdminPage()).rejects.toThrow("NOT_FOUND");
    session.user = ADMIN;
    await expect(requireAdminPage()).resolves.toEqual(ADMIN);
  });

  it("reserves deployment AI and news keys for admins", async () => {
    const { getActiveAIConfig, getActiveNewsConfigs } = await import("@/lib/credentials.server");
    process.env.DEEPSEEK_API_KEY = "deployment-ai-key";
    process.env.GNEWS_API_KEY = "deployment-news-key";
    try {
      session.user = USER;
      expect(await getActiveAIConfig()).toBeNull();
      expect(await getActiveNewsConfigs()).toEqual([]);
      session.user = ADMIN;
      expect((await getActiveAIConfig())?.apiKey).toBe("deployment-ai-key");
      expect((await getActiveNewsConfigs()).map((config) => config.apiKey)).toEqual(["deployment-news-key"]);
      session.user = null;
      expect(await getActiveAIConfig()).toBeNull();
      expect(await getActiveNewsConfigs()).toEqual([]);
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.GNEWS_API_KEY;
    }
  });
});
