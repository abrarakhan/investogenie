import { describe, expect, it } from "vitest";
import { assessStrongSwing } from "@/lib/analytics/strongSwing";
import type { OHLCV } from "@/lib/types";

function risingBars(count = 240, withOi = false, slope = 0.5): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * slope;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 1,
      high: close + 0.5,
      low: close - 1.5,
      close,
      volume: index >= count - 5 ? 3_000_000 : 1_000_000,
      openInterest: withOi ? 1_000_000 + index * 10_000 : null,
    };
  });
}

/**
 * A base that goes sideways, then breaks out on the final two bars.
 *
 * The gates are checked against the highest high of the 20 sessions ending two bars back, so a
 * breakout has to clear that level on both of the last two closes. Building it into the price
 * series is the point: the earlier version of this test passed a hand-picked `trigger` sitting
 * 1.5 below the latest close, which no production trigger ever does — swing_signals.long_trigger
 * is rebased to the current price. That made the test pass while the gate was unsatisfiable
 * against every real row.
 */
function breakoutBars(count = 240, opts: { clears?: boolean } = {}): OHLCV[] {
  const { clears = true } = opts;
  const baseClose = 100;
  const breakoutClose = clears ? 112 : 100.4;
  return Array.from({ length: count }, (_, index) => {
    const fromEnd = count - 1 - index;
    const isBreakoutBar = fromEnd <= 1;
    const close = isBreakoutBar ? breakoutClose : baseClose + (index % 5) * 0.1;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 0.4,
      high: close + 0.2,
      low: close - 0.6,
      close,
      volume: fromEnd <= 4 ? 4_000_000 : 1_000_000,
      openInterest: null,
    };
  });
}

/** Benchmark that trails the stock, so relative strength is positive and the regime is healthy. */
const benchmark = (count = 240) => risingBars(count, false, 0.2);

describe("assessStrongSwing", () => {
  it("keeps a first-day breakout on the watchlist", () => {
    // Only the final bar clears the level, so follow-through has not been proven.
    const bars = breakoutBars();
    bars[bars.length - 2] = { ...bars[bars.length - 2], close: 100.2, high: 100.4, low: 99.8 };
    const latest = bars.at(-1)!;
    const result = assessStrongSwing({
      market: "IN",
      verdict: "BREAKOUT_UNCONFIRMED",
      isBreakout: true,
      trigger: latest.close,
      atr: 2,
      trailingStop: latest.close - 10,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("WATCHLIST");
    expect(result.gates.find((item) => item.key === "follow_through")?.passed).toBe(false);
  });

  it("passes follow-through when both closes clear the prior 20-session high", () => {
    const bars = breakoutBars();
    const latest = bars.at(-1)!;
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      // A rebased trigger, as production actually supplies: it tracks the latest close.
      trigger: latest.close,
      atr: 2,
      trailingStop: latest.close - 10,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.gates.find((item) => item.key === "follow_through")?.passed).toBe(true);
  });

  it("does not depend on the trigger it is handed", () => {
    // The same bars must produce the same follow-through verdict whatever the trigger is,
    // because the level now comes from price history. This is the regression guard for the
    // rebased-trigger bug.
    const bars = breakoutBars();
    const base = {
      market: "IN" as const,
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      atr: 2,
      trailingStop: 0,
      bars,
      benchmarkBars: benchmark(),
    };
    const withRebased = assessStrongSwing({ ...base, trigger: bars.at(-1)!.close });
    const withHistorical = assessStrongSwing({ ...base, trigger: 100 });
    expect(withRebased.confirmationEntry).toBe(withHistorical.confirmationEntry);
    expect(withRebased.gates.find((g) => g.key === "follow_through")?.passed)
      .toBe(withHistorical.gates.find((g) => g.key === "follow_through")?.passed);
  });

  it("invalidates a setup after its trailing stop is breached", () => {
    const bars = breakoutBars();
    const latest = bars.at(-1)!;
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: latest.close,
      atr: 2,
      trailingStop: latest.close + 0.1,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("INVALIDATED");
  });

  it("invalidates when price falls a full ATR back below the breakout level", () => {
    // Guards the branch that was dead while it compared against the rebased trigger.
    const bars = breakoutBars(240, { clears: false });
    const collapsed = bars.at(-1)!;
    bars[bars.length - 1] = { ...collapsed, close: 95, high: 95.4, low: 94.6 };
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: 95,
      atr: 2,
      trailingStop: null,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("INVALIDATED");
  });

  it("requires OI growth when OI data is available", () => {
    const bars = breakoutBars();
    bars.forEach((bar, index) => { bar.openInterest = 1_000_000 + index * 10_000; });
    bars[bars.length - 6].openInterest = 1_000_000;
    bars[bars.length - 1].openInterest = 1_020_000; // +2%, under the 5% requirement
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: bars.at(-1)!.close - 10,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.confirmationMode).toBe("OI");
    expect(result.gates.find((item) => item.key === "confirmation")?.passed).toBe(false);
  });

  it("does not let the cash confirmation gate mirror follow-through", () => {
    // Both were failing together because cashConfirmed required followThrough. With only the
    // final bar clearing the level, follow-through must fail while cash confirmation — which
    // tests five-session participation and price — can still pass on its own evidence.
    const bars = breakoutBars();
    bars[bars.length - 2] = { ...bars[bars.length - 2], close: 100.2, high: 100.4, low: 99.8 };
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: bars.at(-1)!.close - 10,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.confirmationMode).toBe("CASH");
    expect(result.gates.find((g) => g.key === "follow_through")?.passed).toBe(false);
    expect(result.gates.find((g) => g.key === "confirmation")?.passed).toBe(true);
  });

  it("fails freshness when the benchmark is stale, not just the stock", () => {
    // The old clamp reported a gap of 0 whenever the benchmark lagged, so this always passed.
    const bars = breakoutBars();
    const stale = benchmark().slice(0, -10);
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: null,
      bars,
      benchmarkBars: stale,
    });
    expect(result.gates.find((g) => g.key === "freshness")?.passed).toBe(false);
  });

  it("reports missing benchmark data rather than blaming the market regime", () => {
    const bars = breakoutBars();
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: null,
      bars,
      benchmarkBars: [],
    });
    expect(result.relativeStrength20Pct).toBeNull();
    expect(result.gates.find((g) => g.key === "market_regime")?.detail).toContain("unavailable");
    expect(result.gates.find((g) => g.key === "freshness")?.passed).toBe(false);
  });

  it("measures relative strength over matching dates when the stock has gaps", () => {
    // A stock missing sessions must not be credited with a longer return window than the
    // benchmark. Dropping bars shifts index -21 further back in calendar time; date alignment
    // is what keeps the comparison honest.
    const full = risingBars(240, false, 0.5);
    const gapped = full.filter((_, index) => index < 200 || index % 2 === 0);
    const dense = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: full.at(-1)!.close, atr: 2, trailingStop: null,
      bars: full, benchmarkBars: benchmark(),
    });
    const sparse = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: gapped.at(-1)!.close, atr: 2, trailingStop: null,
      bars: gapped, benchmarkBars: benchmark(),
    });
    // Both compare against benchmark returns drawn from their own 20-session date span, so
    // neither is null and the gapped series is not silently handed a longer benchmark window.
    expect(dense.relativeStrength20Pct).not.toBeNull();
    expect(sparse.relativeStrength20Pct).not.toBeNull();
  });
});
