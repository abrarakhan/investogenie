// One-minute candle types and aggregation. Kept free of server imports so the
// chart can use it in the browser.

export interface IntradayBar {
  /** Start of the bar, epoch seconds (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface IntradaySeries {
  ticker: string;
  exchange: string;
  bars: IntradayBar[];
  /** True when any bar still comes from live ticks rather than the broker's candles. */
  provisional: boolean;
}

export const INTRADAY_INTERVALS = [1, 5, 15] as const;
export type IntradayInterval = (typeof INTRADAY_INTERVALS)[number];

/**
 * Combine one-minute bars into wider ones. Buckets follow the clock, which lines
 * up with the 09:15 IST open for 5 and 15 minutes. A missing minute is simply
 * absent from its bucket; volume stays unknown only if no bar in the bucket has one.
 */
export function aggregateIntradayBars(bars: IntradayBar[], minutes: IntradayInterval): IntradayBar[] {
  if (minutes === 1) return bars;
  const width = minutes * 60;
  const out: IntradayBar[] = [];
  for (const bar of bars) {
    const start = Math.floor(bar.time / width) * width;
    const last = out[out.length - 1];
    if (last && last.time === start) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      if (bar.volume !== null) last.volume = (last.volume ?? 0) + bar.volume;
    } else {
      out.push({ ...bar, time: start });
    }
  }
  return out;
}
