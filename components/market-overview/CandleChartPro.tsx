"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import type { OverviewCandle } from "@/lib/marketOverview";
import { buildChartSeries, type ChartInterval, type ChartRange } from "@/lib/chartSeries";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(`${iso}T00:00:00Z`));
}

function fmtPrice(value: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    maximumFractionDigits: value < 100 ? 2 : 1,
  }).format(value);
}

function fmtVolume(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function pct(from: number, to: number): string {
  if (!from) return "-";
  const value = ((to - from) / from) * 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

interface Readout {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export default function CandleChartPro({
  candle,
  accent,
  currency,
}: {
  candle: OverviewCandle;
  accent: string;
  currency: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [chartInterval, setChartInterval] = useState<ChartInterval>("1D");
  const [range, setRange] = useState<ChartRange>("1Y");
  const [chartStyle, setChartStyle] = useState<"CANDLES" | "LINE">("CANDLES");
  const [showVolume, setShowVolume] = useState(true);
  const [showSma20, setShowSma20] = useState(false);
  const [showSma50, setShowSma50] = useState(false);

  const series = useMemo(
    () => buildChartSeries(candle.points, range, chartInterval, [20, 50]),
    [candle.points, chartInterval, range],
  );
  const displayedPoints = series.points;

  const candleData = useMemo<CandlestickData<Time>[]>(
    () => displayedPoints.map((point) => ({
      time: point.date,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
    })),
    [displayedPoints],
  );

  const volumeData = useMemo<HistogramData<Time>[]>(
    () => displayedPoints.map((point) => ({
      time: point.date,
      value: point.volume ?? 0,
      color: point.close >= point.open ? "rgba(53, 211, 153, 0.32)" : "rgba(255, 107, 118, 0.32)",
    })),
    [displayedPoints],
  );

  const sma20Data = useMemo<LineData<Time>[]>(
    () => (series.averages[20] ?? []).map((point) => ({ time: point.date, value: point.value })),
    [series],
  );
  const sma50Data = useMemo<LineData<Time>[]>(
    () => (series.averages[50] ?? []).map((point) => ({ time: point.date, value: point.value })),
    [series],
  );

  const byTime = useMemo(() => {
    const map = new Map<string, Readout>();
    for (const point of displayedPoints) {
      map.set(point.date, {
        date: point.date,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        volume: point.volume,
      });
    }
    return map;
  }, [displayedPoints]);

  const latest = displayedPoints[displayedPoints.length - 1] ?? null;
  const shown = readout ?? (latest ? {
    date: latest.date,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    close: latest.close,
    volume: latest.volume,
  } : null);
  const change = latest ? pct(latest.open, latest.close) : "-";
  const changeTone = latest && latest.close >= latest.open ? "text-[#35d399]" : "text-[#ff6b76]";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      height: 430,
      layout: {
        background: { type: ColorType.Solid, color: "#0d1115" },
        textColor: "rgba(231, 235, 239, 0.62)",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(53, 211, 153, 0.055)" },
        horzLines: { color: "rgba(255, 255, 255, 0.07)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(139, 151, 164, 0.72)", labelBackgroundColor: "#1a222b" },
        horzLine: { color: "rgba(139, 151, 164, 0.72)", labelBackgroundColor: "#1a222b" },
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.12)",
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.12)",
        timeVisible: false,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        minBarSpacing: 3,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      localization: {
        priceFormatter: (price: number) => fmtPrice(price, currency),
      },
    });

    if (chartStyle === "CANDLES") {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#35d399", downColor: "#ff6b76", borderUpColor: "#35d399", borderDownColor: "#ff6b76",
        wickUpColor: "#35d399", wickDownColor: "#ff6b76", priceLineColor: accent, priceLineWidth: 2,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
      candleSeries.setData(candleData);
    } else {
      const lineSeries = chart.addSeries(LineSeries, { color: accent, lineWidth: 2, priceLineColor: accent });
      lineSeries.setData(displayedPoints.map((point) => ({ time: point.date, value: point.close })));
    }

    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false,
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, borderVisible: false });
      volumeSeries.setData(volumeData);
    }
    if (showSma20 && sma20Data.length) {
      const series = chart.addSeries(LineSeries, { color: "#fbbf24", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      series.setData(sma20Data);
    }
    if (showSma50 && sma50Data.length) {
      const series = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      series.setData(sma50Data);
    }
    chart.timeScale().fitContent();

    const handleCrosshair = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setReadout(null);
        return;
      }
      setReadout(byTime.get(String(param.time)) ?? null);
    };

    chart.subscribeCrosshairMove(handleCrosshair);
    chartRef.current = chart;

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
    };
  }, [accent, byTime, candleData, chartStyle, currency, displayedPoints, showSma20, showSma50, showVolume, sma20Data, sma50Data, volumeData]);

  return (
    <div className="overflow-hidden rounded-md border border-[#293039] bg-[#0d1115]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 bg-[#0a0e13] px-2 py-2 text-[10px] font-bold text-white/55 sm:px-3">
        <ControlGroup label="Interval" values={["1D", "5D", "1W", "1M"]} active={chartInterval} onChange={(value) => setChartInterval(value as ChartInterval)} />
        <span className="mx-1 h-5 w-px bg-white/10" />
        <ControlGroup label="Range" values={["1M", "3M", "6M", "1Y", "ALL"]} active={range} onChange={(value) => setRange(value as ChartRange)} />
        <span className="mx-1 h-5 w-px bg-white/10" />
        <Toggle active={chartStyle === "CANDLES"} onClick={() => setChartStyle("CANDLES")}>Candles</Toggle>
        <Toggle active={chartStyle === "LINE"} onClick={() => setChartStyle("LINE")}>Line</Toggle>
        <Toggle active={showVolume} onClick={() => setShowVolume((value) => !value)}>Volume</Toggle>
        <Toggle active={showSma20} color="text-amber-300" onClick={() => setShowSma20((value) => !value)}>SMA 20</Toggle>
        <Toggle active={showSma50} color="text-violet-300" onClick={() => setShowSma50((value) => !value)}>SMA 50</Toggle>
        <button type="button" onClick={() => chartRef.current?.timeScale().fitContent()} className="ml-auto rounded border border-white/10 px-2 py-1.5 hover:bg-white/10">Fit</button>
      </div>
      <div className="relative">
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-[#2b333d] bg-[#0d1115]/92 px-3 py-2 shadow-xl backdrop-blur">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/35">
          <span className="font-bold text-white/70">{candle.ticker}</span>
          {shown && <span>{fmtDate(shown.date)}</span>}
          <span className={changeTone}>{change}</span>
        </div>
        {shown && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-white/35 sm:grid-cols-5">
            <span>O <b className="font-mono text-white/85">{fmtPrice(shown.open, currency)}</b></span>
            <span>H <b className="font-mono text-[#35d399]">{fmtPrice(shown.high, currency)}</b></span>
            <span>L <b className="font-mono text-[#ff6b76]">{fmtPrice(shown.low, currency)}</b></span>
            <span>C <b className="font-mono text-white/85">{fmtPrice(shown.close, currency)}</b></span>
            <span>V <b className="font-mono text-white/85">{fmtVolume(shown.volume)}</b></span>
          </div>
        )}
      </div>

      <div ref={containerRef} className="h-[430px] w-full" />

      <div className="pointer-events-none absolute bottom-2 right-3 rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/35">
        {chartInterval} · Scroll to zoom · drag to pan
      </div>
      </div>
    </div>
  );
}

function Toggle({ active, onClick, color = "text-white/65", children }: { active: boolean; onClick: () => void; color?: string; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded border px-2 py-1.5 ${active ? `border-cyan-400/40 bg-cyan-400/10 ${color}` : "border-white/10 text-white/40 hover:bg-white/10"}`}>{children}</button>;
}

function ControlGroup({ label, values, active, onChange }: { label: string; values: string[]; active: string; onChange: (value: string) => void }) {
  return <div className="flex items-center gap-1" aria-label={label}>
    {values.map((value) => <button key={value} type="button" onClick={() => onChange(value)} className={`rounded px-2 py-1.5 ${active === value ? "bg-white/12 text-white" : "text-white/40 hover:bg-white/8"}`}>{value}</button>)}
  </div>;
}
