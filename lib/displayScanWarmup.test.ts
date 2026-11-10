import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => query(...args), queryOne: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
const calls: string[] = [];
vi.mock("@/lib/displayScanCache", () => {
  const record = (name: string) => async (market: string, settings?: { stopAtrMult: number }) => {
    calls.push(`${name}:${market}${settings ? `:${settings.stopAtrMult}` : ""}`);
    if (name === "armed" && market === "US") throw new Error("db down");
    return [];
  };
  return {
    displayStrongSwing: record("strong"), displayLegacyMomentum: record("legacy"), displayMomentumV2: record("v2"),
    displayArmedSwing: record("armed"), displayTrendContinuation: record("trend"), displayMarketOverview: record("markets"),
  };
});

import { DEFAULT_SETTINGS } from "@/lib/settings";
import { warmDisplayScans, warmupSettings } from "@/lib/displayScanWarmup";

describe("display scan warm-up", () => {
  beforeEach(() => { query.mockReset(); calls.length = 0; });

  it("warms the defaults plus distinct saved settings, without duplicates", async () => {
    query.mockResolvedValue([
      { stop_atr_mult: "1.500", target_rr: "2.000", trail_atr_mult: "3.000", include_short: true },
      { stop_atr_mult: "2.000", target_rr: "3.000", trail_atr_mult: "3.000", include_short: false },
    ]);
    const sets = await warmupSettings();
    expect(sets).toEqual([DEFAULT_SETTINGS, { stopAtrMult: 2, targetRR: 3, trailAtrMult: 3, includeShort: false }]);
  });

  it("runs every screen for both markets one at a time and survives a failure", async () => {
    query.mockResolvedValue([]);
    const result = await warmDisplayScans();
    expect(calls).toEqual([
      "strong:IN:1.5", "legacy:IN:1.5", "v2:IN:1.5", "armed:IN:1.5", "trend:IN", "markets:IN",
      "strong:US:1.5", "legacy:US:1.5", "v2:US:1.5", "armed:US:1.5", "trend:US", "markets:US",
    ]);
    expect(result).toMatchObject({ warmed: 11, failed: 1 });
  });
});
