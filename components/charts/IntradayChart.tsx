"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart,
  type IChartApi, type MouseEventParams, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { INTRADAY_INTERVALS, aggregateIntradayBars, type IntradayBar, type IntradayInterval, type IntradaySeries } from "@/lib/intradayAggregate";

// The chart library draws times as UTC, so bars are shifted to show IST clock times.
const IST_OFFSET_SECONDS = 19_800;

const price = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
const clock = (seconds: number) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(seconds * 1000));

export default function IntradayChart({
  series, sessions, onSessionsChange,
}: {
  series: IntradaySeries;
  sessions: number;
  onSessionsChange: (sessions: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [minutes, setMinutes] = useState<IntradayInterval>(1);
  const [hovered, setHovered] = useState<IntradayBar | null>(null);

  const bars = useMemo(() => aggregateIntradayBars(series.bars, minutes), [series.bars, minutes]);
  const byTime = useMemo(() => new Map(bars.map((bar) => [bar.time + IST_OFFSET_SECONDS, bar])), [bars]);
  const shown = hovered ?? bars[bars.length - 1] ?? null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      height: 430,
      layout: { background: { type: ColorType.Solid, color: "#0d1115" }, textColor: "rgba(231, 235, 239, 0.62)" },
      grid: { vertLines: { color: "rgba(53, 211, 153, 0.055)" }, horzLines: { color: "rgba(255, 255, 255, 0.07)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(255, 255, 255, 0.12)", scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: "rgba(255, 255, 255, 0.12)", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { priceFormatter: price },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#35d399", downColor: "#ff6b76", borderUpColor: "#35d399", borderDownColor: "#ff6b76",
      wickUpColor: "#35d399", wickDownColor: "#ff6b76", priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    candles.setData(bars.map((bar) => ({
      time: (bar.time + IST_OFFSET_SECONDS) as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    })));
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, borderVisible: false });
    volume.setData(bars.map((bar) => ({
      time: (bar.time + IST_OFFSET_SECONDS) as UTCTimestamp, value: bar.volume ?? 0,
      color: bar.close >= bar.open ? "rgba(53, 211, 153, 0.32)" : "rgba(255, 107, 118, 0.32)",
    })));
    chart.timeScale().fitContent();
    const onMove = (param: MouseEventParams<Time>) => setHovered(typeof param.time === "number" ? byTime.get(param.time) ?? null : null);
    chart.subscribeCrosshairMove(onMove);
    chartRef.current = chart;
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, byTime]);

  const pill = (active: boolean) => `rounded px-2 py-1.5 ${active ? "bg-white/12 text-white" : "text-white/40 hover:bg-white/8"}`;
  return (
    <div className="overflow-hidden rounded-md border border-[#293039] bg-[#0d1115]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 bg-[#0a0e13] px-2 py-2 text-[10px] font-bold text-white/55 sm:px-3">
        <div className="flex items-center gap-1" aria-label="Bar size">
          {INTRADAY_INTERVALS.map((value) => (
            <button key={value} type="button" onClick={() => setMinutes(value)} className={pill(minutes === value)}>{value}m</button>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <div className="flex items-center gap-1" aria-label="Sessions">
          {[1, 5].map((value) => (
            <button key={value} type="button" onClick={() => onSessionsChange(value)} className={pill(sessions === value)}>{value === 1 ? "Latest session" : "5 sessions"}</button>
          ))}
        </div>
        <button type="button" onClick={() => chartRef.current?.timeScale().fitContent()} className="ml-auto rounded border border-white/10 px-2 py-1.5 hover:bg-white/10">Fit</button>
      </div>
      <div className="relative">
        {shown && (
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-[#2b333d] bg-[#0d1115]/92 px-3 py-2 text-[10px] uppercase tracking-wider text-white/35 shadow-xl backdrop-blur">
            <div className="mb-1 flex gap-2"><span className="font-bold text-white/70">{series.ticker}</span><span>{clock(shown.time)} IST</span></div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-5">
              <span>O <b className="font-mono text-white/85">{price(shown.open)}</b></span>
              <span>H <b className="font-mono text-[#35d399]">{price(shown.high)}</b></span>
              <span>L <b className="font-mono text-[#ff6b76]">{price(shown.low)}</b></span>
              <span>C <b className="font-mono text-white/85">{price(shown.close)}</b></span>
              <span>V <b className="font-mono text-white/85">{shown.volume === null ? "-" : new Intl.NumberFormat("en-IN").format(shown.volume)}</b></span>
            </div>
          </div>
        )}
        <div ref={containerRef} className="h-[430px] w-full" />
      </div>
      {series.provisional && (
        <p className="border-t border-white/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100/60">
          Some bars are built from live ticks and can miss trades or volume. They are replaced with the broker&apos;s own candles after the close.
        </p>
      )}
    </div>
  );
}
