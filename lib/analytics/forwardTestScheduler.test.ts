import { describe, expect, it } from "vitest";
import { runForwardTestStage } from "../../scripts/forward-test-scheduler.mjs";

describe("forward-test scheduling", () => {
  it("grades open positions before enrolling the session's calls", async () => {
    const calls: string[] = [];
    const callRoute = async (query: string) => { calls.push(query); return "{}"; };
    await runForwardTestStage({ market: "US", callRoute });
    expect(calls).toEqual(["action=evaluate", "action=enroll&market=US"]);
  });

  it("does not enrol when grading fails, so the stage is retried as a whole", async () => {
    const calls: string[] = [];
    const callRoute = async (query: string) => {
      calls.push(query);
      if (query === "action=evaluate") throw new Error("down");
      return "{}";
    };
    await expect(runForwardTestStage({ market: "IN", callRoute })).rejects.toThrow("down");
    expect(calls).toEqual(["action=evaluate"]);
  });
});
