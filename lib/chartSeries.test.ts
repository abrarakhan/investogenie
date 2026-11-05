import { describe, expect, it } from "vitest";
import { aggregateChartPoints, buildChartSeries, movingAverage, selectChartRange, type ChartPoint } from "@/lib/chartSeries";

const points = (count: number): ChartPoint[] => Array.from({ length: count }, (_, index) => ({
  date: `2026-01-${String(index + 1).padStart(2, "0")}`,
  open: index + 1,
  high: index + 2,
  low: index,
  close: index + 1.5,
  volume: 100 + index,
}));

describe("chart series", () => {
  it("keeps the latest trading sessions for visible ranges", () => {
    const series = points(100);
    expect(selectChartRange(series, "1M")).toHaveLength(22);
    expect(selectChartRange(series, "ALL")).toHaveLength(100);
  });

  it("builds aligned five-session OHLCV candles", () => {
    const result = aggregateChartPoints(points(10), "5D");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ open: 1, high: 6, low: 0, close: 5.5, volume: 510 });
    expect(result[1]).toMatchObject({ open: 6, high: 11, low: 5, close: 10.5, volume: 535 });
  });

  it("computes moving averages from full history before applying the range", () => {
    const series = Array.from({ length: 120 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
      return { date, open: index, high: index + 1, low: index - 1, close: index, volume: 1 };
    });
    const result = buildChartSeries(series, "1M", "1D", [20, 50]);
    expect(result.points).toHaveLength(22);
    // Every visible bar carries both averages, and SMA 50 at the last bar is the true 50-bar mean.
    expect(result.averages[20]).toHaveLength(22);
    expect(result.averages[50]).toHaveLength(22);
    expect(result.averages[50]?.at(-1)?.value).toBeCloseTo(94.5);
  });

  it("computes moving averages on the displayed interval", () => {
    expect(movingAverage(points(4), 3)).toEqual([
      { date: "2026-01-03", value: 2.5 },
      { date: "2026-01-04", value: 3.5 },
    ]);
  });
});
