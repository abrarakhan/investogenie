#!/usr/bin/env node
// Lightweight route smoke tests for a running InvestoGenie server.
// Usage:
//   npm run smoke
//   SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke

const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 15_000);

const publicRoutes = [
  { path: "/", contains: "InvestoGenie" },
  { path: "/login", contains: "InvestoGenie" },
  { path: "/markets/us", contains: "Data freshness" },
  { path: "/markets/in", contains: "Data freshness" },
  { path: "/terminal/us/screener", contains: "Swing Candidates" },
  { path: "/terminal/in/screener", contains: "Swing Candidates" },
];

const protectedRoutes = [
  "/terminal/us",
  "/terminal/in",
  "/settings",
  "/admin/sync",
];

function withTimeout(signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function request(path, init = {}) {
  const { signal, clear } = withTimeout(init.signal);
  try {
    return await fetch(`${baseUrl}${path}`, { ...init, signal });
  } finally {
    clear();
  }
}

async function checkPublic(route) {
  const res = await request(route.path, { redirect: "follow" });
  const body = await res.text();
  if (res.status !== 200) {
    throw new Error(`${route.path} expected 200, got ${res.status}`);
  }
  if (route.contains && !body.includes(route.contains)) {
    throw new Error(`${route.path} did not contain marker ${JSON.stringify(route.contains)}`);
  }
  return `${route.path} 200`;
}

async function checkProtected(path) {
  const res = await request(path, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  if (res.status !== 307 && res.status !== 308) {
    throw new Error(`${path} expected redirect, got ${res.status}`);
  }
  if (!location.endsWith("/login") && location !== "/login") {
    throw new Error(`${path} redirected to ${location || "<missing>"}, expected /login`);
  }
  return `${path} redirects to /login`;
}

async function main() {
  console.log(`Smoke testing ${baseUrl}`);
  const results = [];
  for (const route of publicRoutes) results.push(await checkPublic(route));
  for (const route of protectedRoutes) results.push(await checkProtected(route));
  for (const result of results) console.log(`✓ ${result}`);
  console.log(`Smoke tests passed (${results.length} checks).`);
}

main().catch((error) => {
  console.error(`Smoke tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
