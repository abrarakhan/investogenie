import { beforeEach, describe, expect, it } from "vitest";
import { allowAuthAttempt, checkRateLimit, resetRateLimits, trustedClientIp } from "@/lib/rateLimit";

const env = (value?: string) => ({ TRUSTED_PROXY_IP_HEADER: value } as unknown as NodeJS.ProcessEnv);

describe("rate limiting", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit within the window, then reports a retry delay", () => {
    const rule = { limit: 2, windowMs: 1000 };
    expect(checkRateLimit("k", rule, 0).ok).toBe(true);
    expect(checkRateLimit("k", rule, 100).ok).toBe(true);
    const blocked = checkRateLimit("k", rule, 200);
    expect(blocked).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(checkRateLimit("k", rule, 1001).ok).toBe(true);
    expect(checkRateLimit("other", rule, 200).ok).toBe(true);
  });

  it("reads the client IP only from the configured proxy header", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 203.0.113.7" });
    expect(trustedClientIp(headers, env())).toBeNull();
    expect(trustedClientIp(headers, env("x-real-ip"))).toBe("203.0.113.7");
    expect(trustedClientIp(headers, env("X-Forwarded-For"))).toBeNull();
    expect(trustedClientIp(new Headers({ "x-real-ip": "not-an-ip" }), env("x-real-ip"))).toBeNull();
  });

  it("throttles sign-in per account email regardless of IP", () => {
    const rule = { limit: 2, windowMs: 60_000 };
    const headers = new Headers();
    expect(allowAuthAttempt("login", headers, rule, { value: "A@x.com", rule })).toBe(true);
    expect(allowAuthAttempt("login", headers, rule, { value: "a@x.com ", rule })).toBe(true);
    expect(allowAuthAttempt("login", headers, rule, { value: "a@x.com", rule })).toBe(false);
    expect(allowAuthAttempt("login", headers, rule, { value: "b@x.com", rule })).toBe(true);
  });
});
