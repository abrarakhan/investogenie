import { describe, expect, it } from "vitest";
import type { ArmedSwingCandidate } from "@/lib/armedSwing";
import type { ScreenRow } from "@/lib/screener";
import type { ScreenerStock } from "@/lib/screener/service";
import {
  MOBILE_SCREEN_CATALOG, armedSwingCard, formatMarketCap, formatMarketDate, formatMoney, formatPct, loadMobileScreen,
  stockScreenerCard, swingCard,
} from "@/lib/mobileScreens";

const swingRow = (overrides: Partial<ScreenRow> = {}): ScreenRow => ({
  assetId: "a1", ticker: "TCS", country: "IN", exchange: "NSE", assetClass: "STOCK", verdict: "BUY_BREAKOUT",
  direction: "LONG", score: 7.25, close: 100, lastQuote: 101, quoteChangePct: 1.5, bandwidthPct: 4,
  isSqueeze: false, isBreakout: true, isLongBuildup: false, reason: "Breakout above the 22-day high.", asOf: "2026-10-23",
  entry: 102, target: 110, stopLoss: 97, trailingStop: 98, riskReward: 1.6, expectedDays: 8,
  strategyTags: ["DARVAS"],
  strategyLevels: { DARVAS: { direction: "LONG", entry: 103, target: 120, stopLoss: 96, trailingStop: 99, riskReward: 2.4, expectedDays: 12, score: 8.8 } },
  peRatio: 30, marketCap: 1_200_000, financialCurrency: "INR", roce: 50, profitVarYoY: null, salesVarYoY: null, fundamentalsAsOf: null,
  ...overrides,
} as ScreenRow);

describe("mobile screen formatting", () => {
  it("formats money, percentages and market cap per market", () => {
    expect(formatMoney(1234.5, "IN")).toBe("₹1,234.50");
    expect(formatMoney(null, "US")).toBe("--");
    expect(formatPct(2)).toBe("+2.00%");
    expect(formatPct(-1.234)).toBe("-1.23%");
    expect(formatPct(15, false)).toBe("15.00%");
    expect(formatMarketCap(1_234_567, "IN")).toBe("12.35L Cr");
    expect(formatMarketCap(2_500, "US")).toBe("$2.5B");
    // A session date stored as IST midnight must not read as the previous UTC day.
    expect(formatMarketDate(new Date("2026-10-25T18:30:00.000Z"), "IN")).toBe("2026-10-26");
    expect(formatMarketDate(null, "IN")).toBe("--");
  });
});

describe("swingCard", () => {
  it("uses the server levels and score without recomputing", () => {
    const card = swingCard(swingRow(), "IN", null, 1);
    expect(card.title).toBe("#1 TCS");
    expect(card.score).toBe("7.3");
    expect(card.metrics.map((metric) => metric.value)).toEqual(["₹102.00", "₹110.00", "₹97.00"]);
    expect(card.badge).toEqual({ label: "+1.50%", tone: "positive" });
  });
  it("shows the selected strategy's own levels and score", () => {
    const card = swingCard(swingRow(), "IN", "DARVAS", 2);
    expect(card.score).toBe("8.8");
    expect(card.metrics.map((metric) => metric.value)).toEqual(["₹103.00", "₹120.00", "₹96.00"]);
    expect(card.footer).toContain("R:R 2.40");
  });
});

describe("armedSwingCard", () => {
  it("carries the plan levels, status wording and gates", () => {
    const candidate = {
      assetId: "a2", ticker: "INFY", name: "Infosys", exchange: "NSE", country: "IN", currentPrice: 148, rank: 1,
      status: "ARMED", strengthScore: 82.4, distanceToTriggerPct: 0.9, suggestedExposurePct: 50,
      plan: { pivot: 149.2, trigger: 149.4, limit: 150.5, stop: 144, target: 160, trail: 145, expectedDays: 10, riskPerSharePct: 3.6, rewardRiskRatio: 2 },
      gates: [
        { key: "relative_strength", label: "Relative strength", passed: true, detail: "RS 92", category: "technical", blocking: true },
        { key: "rs_line", label: "RS line", passed: false, detail: "Below high", category: "technical", blocking: false },
      ],
    } as unknown as ArmedSwingCandidate;
    const card = armedSwingCard(candidate, "IN");
    expect(card.badge).toEqual({ label: "Armed", tone: "positive" });
    expect(card.score).toBe("82");
    expect(card.metrics[0]).toEqual({ label: "TRIGGER", value: "₹149.40" });
    expect(card.guidance).toMatch(/buy-stop/i);
    expect(card.sections[1].rows).toEqual([
      { label: "Relative strength", detail: "RS 92", passed: true },
      { label: "RS line (advisory)", detail: "Below high", passed: false },
    ]);
  });
});

describe("stockScreenerCard", () => {
  it("handles missing snapshot values", () => {
    const card = stockScreenerCard({ asset_id: "a3", symbol: "XYZ", name: null, sector: null, exchange: "NSE", ltp: 10, change_pct_1d: null, market_cap: null, pe_ratio: null } as ScreenerStock, "IN");
    expect(card.subtitle).toBe("NSE");
    expect(card.badge).toBeNull();
    expect(card.metrics.map((metric) => metric.value)).toEqual(["₹10.00", "--", "--"]);
  });
});

describe("screen registry", () => {
  it("serves every cards screen in the catalog and rejects native or unknown keys", () => {
    expect(MOBILE_SCREEN_CATALOG.filter((item) => item.kind === "cards").map((item) => item.key))
      .toEqual(["stock-screener", "swing", "armed-swing", "long-term"]);
    expect(loadMobileScreen("strong-swing", "IN", new URLSearchParams(), "u")).toBeNull();
    expect(loadMobileScreen("toString", "IN", new URLSearchParams(), "u")).toBeNull();
  });
});
