import { describe, expect, it } from "vitest";
import type { ArmedSwingCandidate } from "@/lib/armedSwing";
import type { ScreenRow } from "@/lib/screener";
import type { StrongSwingCandidate } from "@/lib/strongSwing";
import type { MomentumIgnitionCandidate } from "@/lib/momentumIgnition";
import type { TrendContinuationCandidate } from "@/lib/trendContinuation";
import type { ScreenerStock } from "@/lib/screener/service";
import {
  MOBILE_SCREEN_CATALOG, armedSwingCard, formatMarketCap, formatMarketDate, formatMoney, formatPct, loadMobileScreen,
  momentumIgnitionCard, stockScreenerCard, strongSwingCard, swingCard, trendContinuationCard,
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
      .toEqual(["stock-screener", "swing", "strong-swing", "armed-swing", "long-term"]);
    expect(loadMobileScreen("trade-ledger", "IN", new URLSearchParams(), "u")).toBeNull();
    expect(loadMobileScreen("toString", "IN", new URLSearchParams(), "u")).toBeNull();
  });
});

const gate = { key: "trend", label: "Trend", passed: true, detail: "Above SMA50", category: "technical" as const, blocking: true };

describe("strongSwingCard", () => {
  const candidate = {
    assetId: "a1", ticker: "TCS", exchange: "NSE", status: "EXECUTION_READY", strengthScore: 82, strongSwingRank: 2, baseSwingRank: 5,
    lastQuote: 101, latestClose: 100, latestDate: "2026-10-30", strongEntry: 100, strongTarget: 112, strongStop: 96, strongTrail: 97,
    strongExpectedDays: 9, fiveDayReturnPct: 3, tenDayReturnPct: 5, gates: [gate],
  } as unknown as StrongSwingCandidate;

  it("offers logging only with a server-held plan", () => {
    const card = strongSwingCard(candidate, "IN", "plan-1");
    expect(card.badge).toEqual({ label: "Execution ready", tone: "positive" });
    expect(card.subtitle).toContain("up 3");
    expect(card.trade).toEqual({ assetId: "a1", ticker: "TCS", strategyKey: "STRONG_SWING", planId: "plan-1", suggestedPrice: 101 });
    expect(strongSwingCard(candidate, "IN", null).trade).toBeNull();
    expect(strongSwingCard({ ...candidate, status: "WATCHLIST" } as StrongSwingCandidate, "IN", null).guidance).toBe("Buy unavailable");
  });
});

describe("momentumIgnitionCard", () => {
  const candidate = {
    assetId: "a2", ticker: "INFY", name: "Infosys", exchange: "NSE", status: "MOMENTUM_READY", modelStatus: "MOMENTUM_READY",
    executionBlockReason: null, score: 77, currentPrice: 1500, quoteChangePct: 2.2, breakoutLevel: 1480, distanceToBreakoutPct: -1.3,
    relativeStrength20Pct: 4, projectedEntry: 1500, projectedTarget: 1560, projectedStop: 1460, projectedTrail: 1470, projectedDays: 3,
    breakoutAgeSessions: 1, return5Pct: 6, shortHorizonTargetPct: 2.5, shortHorizonDays: 2, timingReasons: ["First thrust held."],
    latestDate: "2026-10-30", gates: [gate],
  } as unknown as MomentumIgnitionCandidate;

  it("labels V2 statuses and carries the Momentum Ignition plan", () => {
    const card = momentumIgnitionCard(candidate, "IN", 1, "plan-2");
    expect(card.badge?.label).toBe("Momentum ready");
    expect(card.trade?.strategyKey).toBe("MOMENTUM_IGNITION");
    expect(card.sections.map((section) => section.title)).toEqual(["Plan", "Timing", "Gates"]);
  });

  it("shows the server's execution block reason", () => {
    const blocked = { ...candidate, status: "EXECUTION_BLOCKED", executionBlockReason: "Stop wider than 6%." } as unknown as MomentumIgnitionCandidate;
    const card = momentumIgnitionCard(blocked, "IN", 1, null);
    expect(card.badge).toEqual({ label: "Execution blocked", tone: "negative" });
    expect(card.guidance).toBe("Stop wider than 6%.");
    expect(card.trade).toBeNull();
  });
});

describe("trendContinuationCard", () => {
  it("is observation only and shows the stored levels", () => {
    const card = trendContinuationCard({
      assetId: "a3", ticker: "SAREGAMA", name: "Saregama", status: "TREND_CONTINUATION_READY", ready: true, observationOnly: true,
      score: 100, entry: 536, stop: 507.5, target: 593, asOfMarketDate: "2026-10-29", computedAt: "", reasons: ["Range breakout ignited."],
      metrics: { breakout_level: 519.35, ignition_gain_atr: 1.77, volume_ratios: [1.05, 2.98] },
    } as TrendContinuationCandidate, "IN", 1);
    expect(card.badge).toEqual({ label: "Continuation ready", tone: "positive" });
    expect(card.metrics[0]).toEqual({ label: "ENTRY", value: "₹536.00" });
    expect(card.trade).toBeUndefined();
    expect(card.guidance).toContain("Observation only");
  });
});
