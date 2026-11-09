import { beforeEach, describe, expect, it } from "vitest";
import { DISPLAY_SCAN_TTL_MS, cachedForDisplay, resetDisplayScanCache } from "@/lib/displayScanCache";

describe("cachedForDisplay", () => {
  beforeEach(() => resetDisplayScanCache());

  it("reuses a result for 60 seconds, then recomputes", async () => {
    let clock = 1_000;
    let calls = 0;
    const compute = async () => ++calls;
    expect(await cachedForDisplay("k", compute, () => clock)).toBe(1);
    clock += DISPLAY_SCAN_TTL_MS - 1;
    expect(await cachedForDisplay("k", compute, () => clock)).toBe(1);
    clock += 1;
    expect(await cachedForDisplay("k", compute, () => clock)).toBe(2);
    expect(DISPLAY_SCAN_TTL_MS).toBe(60_000);
  });

  it("shares one in-flight computation between concurrent requests", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const compute = async () => { calls++; await gate; return "scan"; };
    const both = Promise.all([cachedForDisplay("k", compute), cachedForDisplay("k", compute)]);
    release();
    expect(await both).toEqual(["scan", "scan"]);
    expect(calls).toBe(1);
  });

  it("never caches a failure", async () => {
    await expect(cachedForDisplay("k", async () => { throw new Error("db down"); })).rejects.toThrow("db down");
    expect(await cachedForDisplay("k", async () => "recovered")).toBe("recovered");
  });

  it("keeps different markets and settings apart", async () => {
    expect(await cachedForDisplay("strong:IN:a", async () => "in")).toBe("in");
    expect(await cachedForDisplay("strong:US:a", async () => "us")).toBe("us");
    expect(await cachedForDisplay("strong:IN:b", async () => "in-b")).toBe("in-b");
  });
});
