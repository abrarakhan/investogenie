import { describe, expect, it } from "vitest";
import { dueEodSession, dueLateUsSession } from "../../scripts/eod-scheduler.mjs";

describe("post-close scheduling", () => {
  it("waits for India file publication", () => {
    expect(dueEodSession("IN", new Date("2026-09-18T12:00:00Z"))).toBe("2026-09-17");
    expect(dueEodSession("IN", new Date("2026-09-18T13:00:00Z"))).toBe("2026-09-18");
  });
  it("uses New York time rather than 22:00 IST", () => {
    expect(dueEodSession("US", new Date("2026-09-18T16:30:00Z"))).toBe("2026-09-17");
    expect(dueEodSession("US", new Date("2026-09-18T21:00:00Z"))).toBe("2026-09-18");
  });
  it("does not expect a new session on holidays or weekends", () => {
    expect(dueEodSession("IN", new Date("2026-09-14T14:00:00Z"))).toBe("2026-09-11");
    expect(dueEodSession("US", new Date("2026-09-19T22:00:00Z"))).toBe("2026-09-18");
  });
  it("treats the Sunday Muhurat session as the completed India session", () => {
    expect(dueEodSession("IN", new Date("2026-11-08T12:30:00Z"))).toBe("2026-11-06");
    expect(dueEodSession("IN", new Date("2026-11-08T13:01:00Z"))).toBe("2026-11-08");
    expect(dueEodSession("IN", new Date("2026-11-09T03:00:00Z"))).toBe("2026-11-08");
  });
  it("runs the late US pass at 22:00 New York time", () => {
    // 2026-11-05 is EST (UTC-5): 22:00 ET = 03:00Z next day.
    expect(dueLateUsSession(new Date("2026-11-06T02:30:00Z"))).toBe("2026-11-04");
    expect(dueLateUsSession(new Date("2026-11-06T03:00:00Z"))).toBe("2026-11-05");
  });
  it("follows US winter daylight saving offset", () => {
    expect(dueEodSession("US", new Date("2026-12-01T21:30:00Z"))).toBe("2026-11-30");
    expect(dueEodSession("US", new Date("2026-12-01T22:00:00Z"))).toBe("2026-12-01");
  });
});
