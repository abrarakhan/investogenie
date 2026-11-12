import { describe, expect, it } from "vitest";
import { aggregateIntradayBars, type IntradayBar } from "./intradayAggregate";

// 09:15 IST on 13 Nov 2026.
const OPEN = Date.UTC(2026, 10, 13, 3, 45) / 1000;
const bar = (minute: number, open: number, high: number, low: number, close: number, volume: number | null): IntradayBar =>
  ({ time: OPEN + minute * 60, open, high, low, close, volume });

describe("aggregateIntradayBars", () => {
  it("returns one-minute bars untouched", () => {
    const bars = [bar(0, 1, 2, 1, 2, 10)];
    expect(aggregateIntradayBars(bars, 1)).toBe(bars);
  });

  it("builds five-minute bars that start at the 09:15 open", () => {
    const bars = [
      bar(0, 100, 101, 99, 100.5, 10), bar(1, 100.5, 103, 100, 102, 20), bar(4, 102, 102, 98, 99, 5),
      bar(5, 99, 99.5, 98.5, 99.2, 7),
    ];
    expect(aggregateIntradayBars(bars, 5)).toEqual([
      { time: OPEN, open: 100, high: 103, low: 98, close: 99, volume: 35 },
      { time: OPEN + 300, open: 99, high: 99.5, low: 98.5, close: 99.2, volume: 7 },
    ]);
  });

  it("keeps volume unknown only when no bar in the bucket has one", () => {
    const [first, second] = aggregateIntradayBars(
      [bar(0, 1, 1, 1, 1, null), bar(1, 1, 1, 1, 1, 4), bar(15, 1, 1, 1, 1, null)], 15,
    );
    expect(first.volume).toBe(4);
    expect(second.volume).toBeNull();
  });

  it("does not modify its input", () => {
    const bars = [bar(0, 1, 2, 1, 2, 10), bar(1, 2, 3, 2, 3, 10)];
    aggregateIntradayBars(bars, 5);
    expect(bars[0]).toEqual(bar(0, 1, 2, 1, 2, 10));
  });
});
