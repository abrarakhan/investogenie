import { describe, expect, it } from "vitest";
import { hashMobileToken, readBearerToken } from "./mobileAuth";

describe("mobile bearer authentication", () => {
  it("accepts URL-safe bearer tokens and rejects malformed headers", () => {
    const token = "a".repeat(42) + "_-";
    expect(readBearerToken(`Bearer ${token}`)).toBe(token);
    expect(readBearerToken(`Basic ${token}`)).toBeNull();
    expect(readBearerToken("Bearer short")).toBeNull();
    expect(readBearerToken(null)).toBeNull();
  });

  it("hashes tokens deterministically without retaining the credential", () => {
    const token = "private-mobile-token";
    const hash = hashMobileToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashMobileToken(token));
    expect(hash).not.toContain(token);
  });
});

