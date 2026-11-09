import { isIP } from "node:net";

/**
 * In-process sliding-window rate limiter. Production runs one Next.js process
 * behind nginx, so process memory is the shared limiter state; no new store.
 */
export interface RateLimitRule { limit: number; windowMs: number }
export interface RateLimitResult { ok: boolean; retryAfterSeconds: number }

const hits = new Map<string, number[]>();
let lastSweep = 0;

export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, times] of hits) if (!times.length || now - times[times.length - 1] > 3_600_000) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((at) => now - at < rule.windowMs);
  if (recent.length >= rule.limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + rule.windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterSeconds: 0 };
}

/** Test-only reset. */
export function resetRateLimits(): void {
  hits.clear();
}

/**
 * Client IP from the reverse proxy only. TRUSTED_PROXY_IP_HEADER must name a
 * header the proxy overwrites with the peer address (nginx: X-Real-IP set from
 * $remote_addr). X-Forwarded-For is never read: its left-most value is client
 * controlled. Unset (local dev, or app reachable without the proxy) → null, and
 * callers key on the user ID or a shared anonymous bucket instead.
 */
export function trustedClientIp(headers: Headers, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();
  if (!name || name === "x-forwarded-for") return null;
  const value = headers.get(name)?.trim();
  return value && isIP(value) ? value : null;
}

export const RATE_LIMITS = {
  screener: { limit: 60, windowMs: 60_000 },
  backtest: { limit: 5, windowMs: 60_000 },
  backtestHourly: { limit: 30, windowMs: 3_600_000 },
  marketData: { limit: 240, windowMs: 60_000 },
  screenIntent: { limit: 15, windowMs: 60_000 },
  loginPerIp: { limit: 20, windowMs: 15 * 60_000 },
  loginPerEmail: { limit: 8, windowMs: 15 * 60_000 },
  signupPerIp: { limit: 5, windowMs: 3_600_000 },
  passwordResetPerIp: { limit: 10, windowMs: 3_600_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Sign-in style throttle: per trusted client IP (only when the proxy header is
 * configured) and, optionally, per normalized account email. Returns false when
 * any bucket is exhausted.
 */
export function allowAuthAttempt(
  bucket: string,
  headers: Headers,
  ipRule: RateLimitRule,
  email?: { value: string; rule: RateLimitRule },
): boolean {
  const ip = trustedClientIp(headers);
  if (ip && !checkRateLimit(`${bucket}:ip:${ip}`, ipRule).ok) return false;
  if (email?.value && !checkRateLimit(`${bucket}:email:${email.value.trim().toLowerCase()}`, email.rule).ok) return false;
  return true;
}
