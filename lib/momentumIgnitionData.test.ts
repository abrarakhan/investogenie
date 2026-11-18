import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => query(...args) }));

import { loadMomentumBars, loadMomentumPreliminaryBundle } from "@/lib/momentumIgnitionData";

describe("momentum loaders", () => {
  afterEach(() => query.mockReset());

  it("runs one query when the Legacy and V2 scans ask for the same bundle at once", async () => {
    // react/cache dedupes only inside a request; these two scans refresh as
    // separate display-cache entries, outside any request. Three copies of this
    // 420-day whole-universe query were seen running together on production.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    query.mockImplementation(async () => { await gate; return []; });

    const args = ["IN", "2026-11-18", true, "2026-11-18", 10, 1e7, "[\"NIFTY\"]"] as const;
    const legacy = loadMomentumPreliminaryBundle(...args);
    const v2 = loadMomentumPreliminaryBundle(...args);
    expect(legacy).toBe(v2);

    release();
    await Promise.all([legacy, v2]);
    // The bundle issues three statements; a second caller must add none.
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("keeps different arguments apart", async () => {
    query.mockResolvedValue([]);
    const a = loadMomentumBars("[\"a\"]", false, "2026-11-18");
    const b = loadMomentumBars("[\"b\"]", false, "2026-11-18");
    expect(a).not.toBe(b);
    await Promise.all([a, b]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not retain a completed result, so no caller is served stale rows", async () => {
    query.mockResolvedValue([]);
    await loadMomentumBars("[\"a\"]", false, "2026-11-18");
    await loadMomentumBars("[\"a\"]", false, "2026-11-18");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not wedge the key after a failure", async () => {
    query.mockRejectedValueOnce(new Error("canceling statement due to statement timeout"));
    await expect(loadMomentumBars("[\"a\"]", false, "2026-11-18")).rejects.toThrow("statement timeout");
    query.mockResolvedValue([{ asset_id: "a" }]);
    await expect(loadMomentumBars("[\"a\"]", false, "2026-11-18")).resolves.toEqual([{ asset_id: "a" }]);
  });
});
