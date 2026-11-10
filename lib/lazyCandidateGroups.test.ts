import { describe, expect, it } from "vitest";
import { LAZY_STATUSES, pickLazyGroup, splitForLazyDisplay } from "@/lib/lazyCandidateGroups";
import { isMomentumExecutionReady } from "@/lib/momentumExecution";

const item = (assetId: string, status: string) => ({ assetId, status });

describe("splitForLazyDisplay", () => {
  const list = [item("a", "EXECUTION_READY"), item("b", "WATCHLIST"), item("c", "EXECUTION_READY"), item("d", "INVALIDATED")];

  it("keeps open groups, counts every status, and remembers full-list ranks", () => {
    const split = splitForLazyDisplay(list, "strong");
    expect(split.shown.map((entry) => entry.assetId)).toEqual(["a", "c"]);
    expect(split.counts).toEqual({ EXECUTION_READY: 2, WATCHLIST: 1, INVALIDATED: 1 });
    expect(split.ranks).toEqual({ a: 1, c: 3 });
  });

  it("can be turned off", () => {
    expect(splitForLazyDisplay(list, "strong", { lazy: false }).shown).toHaveLength(4);
  });

  it("returns one group with its full-list ranks", () => {
    expect(pickLazyGroup(list, "WATCHLIST")).toEqual({ items: [item("b", "WATCHLIST")], ranks: { b: 2 } });
  });
});

describe("deferred groups never hold a buyable setup", () => {
  it("keeps every Buy & Track status in the page", () => {
    expect(LAZY_STATUSES.strong.has("EXECUTION_READY")).toBe(false);
    expect(LAZY_STATUSES.armed.has("BUY_ZONE")).toBe(false);
    expect(LAZY_STATUSES.armed.has("ARMED")).toBe(false);
    expect(LAZY_STATUSES.armed.has("TRIGGERED_UNCONFIRMED")).toBe(false);
    expect(LAZY_STATUSES.trend.has("TREND_CONTINUATION_READY")).toBe(false);
    for (const screen of ["momentum-legacy", "momentum-v2"] as const) {
      for (const status of LAZY_STATUSES[screen]) expect(isMomentumExecutionReady(status), `${screen}:${status}`).toBe(false);
    }
    expect(LAZY_STATUSES["momentum-v2"].has("EXECUTION_BLOCKED")).toBe(false);
  });
});
