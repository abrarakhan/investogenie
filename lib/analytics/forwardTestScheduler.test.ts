import { describe, expect, it } from "vitest";
import { enrollmentDue, runForwardTestStage } from "../../scripts/forward-test-scheduler.mjs";

const now = new Date("2026-11-16T13:30:00Z");

describe("forward-test scheduling", () => {
  it("enrols when no cohort was ever recorded or the last one is a week old", () => {
    expect(enrollmentDue(null, now)).toBe(true);
    expect(enrollmentDue(new Date("2026-11-09T13:40:00Z"), now)).toBe(true);
    expect(enrollmentDue(new Date("2026-09-07T03:00:00Z"), now)).toBe(true);
  });

  it("does not enrol again within six days", () => {
    expect(enrollmentDue(new Date("2026-11-11T13:30:00Z"), now)).toBe(false);
    expect(enrollmentDue(new Date("2026-11-16T13:00:00Z"), now)).toBe(false);
  });

  it("always grades positions, and enrols only when due", async () => {
    const calls: string[] = [];
    const callRoute = async (query: string) => { calls.push(query); return "{}"; };
    await runForwardTestStage({ market: "IN", callRoute, lastEnrolledAt: new Date("2026-11-14T13:30:00Z"), now });
    expect(calls).toEqual(["action=evaluate"]);
    calls.length = 0;
    await runForwardTestStage({ market: "US", callRoute, lastEnrolledAt: null, now });
    expect(calls).toEqual(["action=evaluate", "action=enroll&market=US"]);
  });
});
