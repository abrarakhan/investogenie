import { describe, expect, it } from "vitest";
import { isSyncOlderThanSession } from "./broker";

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
