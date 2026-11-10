import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_SCAN_KEEP_WARM_MS,
  DISPLAY_SCAN_MAX_AGE_MS,
  DISPLAY_SCAN_TTL_MS,
  cachedForDisplay,
  displayScanComputedAt,
  resetDisplayScanCache,
} from "@/lib/displayScanCache";

describe("cachedForDisplay", () => {
  beforeEach(() => {
    resetDisplayScanCache();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    resetDisplayScanCache();
    vi.useRealTimers();
  });

  it("reuses a result for 60 seconds", async () => {
    let calls = 0;
    const compute = async () => ++calls;
    expect(await cachedForDisplay("k", compute)).toBe(1);
    vi.setSystemTime(Date.now() + DISPLAY_SCAN_TTL_MS - 1);
    expect(await cachedForDisplay("k", compute)).toBe(1);
    expect(calls).toBe(1);
    expect(DISPLAY_SCAN_TTL_MS).toBe(60_000);
  });

  it("serves the previous result while refreshing an expired one in the background", async () => {
    let calls = 0;
    let release!: () => void;
    const compute = async () => {
      calls++;
      if (calls > 1) await new Promise<void>((resolve) => { release = resolve; });
      return calls;
    };
    expect(await cachedForDisplay("k", compute)).toBe(1);
    vi.setSystemTime(Date.now() + DISPLAY_SCAN_TTL_MS + 1);
    // The reader does not wait for the slow scan.
    expect(await cachedForDisplay("k", compute)).toBe(1);
    expect(calls).toBe(2);
    expect(await cachedForDisplay("k", compute)).toBe(1); // shares the running refresh
    expect(calls).toBe(2);
    release();
    await vi.waitFor(async () => expect(await cachedForDisplay("k", compute)).toBe(2));
  });

  it("keeps a recently read screen warm without anyone waiting", async () => {
    let calls = 0;
    const compute = async () => ++calls;
    expect(await cachedForDisplay("k", compute)).toBe(1);
    await vi.advanceTimersByTimeAsync(DISPLAY_SCAN_TTL_MS);
    expect(calls).toBe(2);
    expect(await cachedForDisplay("k", compute)).toBe(2);
  });

  it("stops background refreshes once a screen goes unread", async () => {
    let calls = 0;
    const compute = async () => ++calls;
    await cachedForDisplay("k", compute);
    await vi.advanceTimersByTimeAsync(DISPLAY_SCAN_KEEP_WARM_MS + 2 * DISPLAY_SCAN_TTL_MS);
    const refreshes = calls;
    expect(refreshes).toBeLessThanOrEqual(Math.ceil(DISPLAY_SCAN_KEEP_WARM_MS / DISPLAY_SCAN_TTL_MS) + 1);
    await vi.advanceTimersByTimeAsync(10 * DISPLAY_SCAN_TTL_MS);
    expect(calls).toBe(refreshes);
  });

  it("makes the reader wait for a fresh scan once the result is too old", async () => {
    let calls = 0;
    const compute = async () => ++calls;
    await cachedForDisplay("k", compute);
    vi.clearAllTimers(); // age the result without keep-warm refreshes
    vi.setSystemTime(Date.now() + DISPLAY_SCAN_MAX_AGE_MS);
    expect(await cachedForDisplay("k", compute)).toBe(2);
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

  it("keeps serving the last good result when a background refresh fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let fail = false;
    const compute = async () => { if (fail) throw new Error("db down"); return "good"; };
    expect(await cachedForDisplay("k", compute)).toBe("good");
    fail = true;
    vi.setSystemTime(Date.now() + DISPLAY_SCAN_TTL_MS + 1);
    expect(await cachedForDisplay("k", compute)).toBe("good");
    await vi.advanceTimersByTimeAsync(0);
    expect(await cachedForDisplay("k", compute)).toBe("good");
    warn.mockRestore();
  });

  it("records when each result was computed", async () => {
    const first = await cachedForDisplay("k", async () => ({ scan: 1 }));
    expect(displayScanComputedAt(first)).toBe(Date.now());
    expect(displayScanComputedAt({})).toBe(0);
    expect(displayScanComputedAt(null)).toBe(0);
  });

  it("keeps different markets and settings apart", async () => {
    expect(await cachedForDisplay("strong:IN:a", async () => "in")).toBe("in");
    expect(await cachedForDisplay("strong:US:a", async () => "us")).toBe("us");
    expect(await cachedForDisplay("strong:IN:b", async () => "in-b")).toBe("in-b");
  });
});

