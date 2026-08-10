import { describe, expect, it } from "vitest";
import { isResetKeyConfigured, resetKeyMatches, MIN_RESET_KEY_LENGTH } from "@/lib/passwordReset";

const VALID_KEY = "a".repeat(MIN_RESET_KEY_LENGTH);

describe("isResetKeyConfigured", () => {
  it("is off when unset, so the reset cannot open by omission", () => {
    expect(isResetKeyConfigured(undefined)).toBe(false);
    expect(isResetKeyConfigured("")).toBe(false);
  });

  it("is off for a key short enough to guess", () => {
    expect(isResetKeyConfigured("a".repeat(MIN_RESET_KEY_LENGTH - 1))).toBe(false);
  });

  it("is on at the minimum length and above", () => {
    expect(isResetKeyConfigured(VALID_KEY)).toBe(true);
    expect(isResetKeyConfigured("a".repeat(64))).toBe(true);
  });
});

describe("resetKeyMatches", () => {
  it("accepts the configured key", () => {
    expect(resetKeyMatches(VALID_KEY, VALID_KEY)).toBe(true);
  });

  it("rejects a wrong key of the same length", () => {
    expect(resetKeyMatches("b".repeat(MIN_RESET_KEY_LENGTH), VALID_KEY)).toBe(false);
  });

  it("rejects wrong lengths without throwing", () => {
    expect(resetKeyMatches("", VALID_KEY)).toBe(false);
    expect(resetKeyMatches("a", VALID_KEY)).toBe(false);
    expect(resetKeyMatches(`${VALID_KEY}x`, VALID_KEY)).toBe(false);
  });

  it("rejects a prefix of the real key", () => {
    expect(resetKeyMatches(VALID_KEY.slice(0, -1), VALID_KEY)).toBe(false);
  });

  it("never matches when no key is configured, whatever is supplied", () => {
    expect(resetKeyMatches("", "")).toBe(false);
    expect(resetKeyMatches("anything", undefined as unknown as string)).toBe(false);
    expect(resetKeyMatches("short", "short")).toBe(false);
  });

  it("compares bytes, not characters, so multi-byte input cannot alias", () => {
    const key = "k".repeat(MIN_RESET_KEY_LENGTH);
    expect(resetKeyMatches("é".repeat(MIN_RESET_KEY_LENGTH), key)).toBe(false);
  });
});
