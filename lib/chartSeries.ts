import type { OverviewCandle } from "@/lib/marketOverview";

export type ChartPoint = OverviewCandle["points"][number];
export type ChartInterval = "1D" | "5D" | "1W" | "1M";
export type ChartRange = "1M" | "3M" | "6M" | "1Y" | "ALL";

const RANGE_SESSIONS: Record<Exclude<ChartRange, "ALL">, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 264,
};

function combine(points: ChartPoint[]): ChartPoint {
  const first = points[0] as ChartPoint;
  const last = points[points.length - 1] as ChartPoint;
  const volumes = points.map((point) => point.volume).filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    date: last.date,
    open: first.open,
    high: Math.max(...points.map((point) => point.high)),
    low: Math.min(...points.map((point) => point.low)),
    close: last.close,
    volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null,
  };
}

function weekKey(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${value.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export function selectChartRange(points: ChartPoint[], range: ChartRange): ChartPoint[] {
  if (range === "ALL") return points;
  return points.slice(-RANGE_SESSIONS[range]);
}

export function aggregateChartPoints(points: ChartPoint[], interval: ChartInterval): ChartPoint[] {
  if (interval === "1D") return points;
  if (interval === "5D") {
    const offset = points.length % 5;
    const groups: ChartPoint[][] = [];
    if (offset) groups.push(points.slice(0, offset));
    for (let index = offset; index < points.length; index += 5) groups.push(points.slice(index, index + 5));
    return groups.filter((group) => group.length).map(combine);
  }
  const grouped = new Map<string, ChartPoint[]>();
  for (const point of points) {
    const key = interval === "1W" ? weekKey(point.date) : point.date.slice(0, 7);
    const group = grouped.get(key) ?? [];
    group.push(point);
    grouped.set(key, group);
  }
  return [...grouped.values()].map(combine);
}

/**
 * Bars and moving averages for one interval and range. Aggregation and averages run on
 * the full history first and the range is applied last, so an SMA 50 on a 1M view is
 * still the 50-bar average at each visible bar rather than missing or starting late.
 */
export function buildChartSeries(
  points: ChartPoint[],
  range: ChartRange,
  interval: ChartInterval,
  periods: number[],
): { points: ChartPoint[]; averages: Record<number, Array<{ date: string; value: number }>> } {
  const bars = aggregateChartPoints(points, interval);
  const firstVisible = selectChartRange(points, range)[0]?.date;
  const visible = (date: string) => firstVisible === undefined || date >= firstVisible;
  const averages: Record<number, Array<{ date: string; value: number }>> = {};
  for (const period of periods) averages[period] = movingAverage(bars, period).filter((point) => visible(point.date));
  return { points: bars.filter((point) => visible(point.date)), averages };
}

export function movingAverage(points: ChartPoint[], period: number): Array<{ date: string; value: number }> {
  if (period < 1) return [];
  let sum = 0;
  return points.flatMap((point, index) => {
    sum += point.close;
    if (index >= period) sum -= (points[index - period] as ChartPoint).close;
    return index >= period - 1 ? [{ date: point.date, value: sum / period }] : [];
  });
}
