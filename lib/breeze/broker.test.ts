import { describe, expect, it } from "vitest";
import { isSyncOlderThanSession, summarizeReconciliationError } from "./broker";

describe("isSyncOlderThanSession", () => {
  it("supersedes an old failure after a new session token is saved", () => {
    expect(isSyncOlderThanSession(
      "2026-09-16T02:37:22+05:30",
      "2026-09-16T06:36:16+05:30",
    )).toBe(true);
  });

  it("keeps a reconciliation result produced after the current session", () => {
    expect(isSyncOlderThanSession(
      "2026-09-16T06:37:00+05:30",
      "2026-09-16T06:36:16+05:30",
    )).toBe(false);
  });

  it("does not supersede when either timestamp is absent", () => {
    expect(isSyncOlderThanSession(null, "2026-09-16T06:36:16+05:30")).toBe(false);
    expect(isSyncOlderThanSession("2026-09-16T02:37:22+05:30", null)).toBe(false);
  });
});

describe("summarizeReconciliationError", () => {
  it("collapses identical stored errors and keeps distinct messages", () => {
    expect(summarizeReconciliationError(
      "ORDER: five-day limit.; ORDER: five-day limit.; TRADE: session expired",
    )).toBe("ORDER: five-day limit. (repeated 2 times); TRADE: session expired");
  });

  it("preserves empty error state", () => {
    expect(summarizeReconciliationError(null)).toBeNull();
  });
});
