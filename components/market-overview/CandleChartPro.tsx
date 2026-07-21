"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import type { OverviewCandle } from "@/lib/marketOverview";

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
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  const candleData = useMemo<CandlestickData<Time>[]>(
    () => candle.points.map((point) => ({
      time: point.date,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
    })),
    [candle.points],
  );

  const volumeData = useMemo<HistogramData<Time>[]>(
    () => candle.points.map((point) => ({
      time: point.date,
      value: point.volume ?? 0,
      color: point.close >= point.open ? "rgba(53, 211, 153, 0.32)" : "rgba(255, 107, 118, 0.32)",
    })),
    [candle.points],
  );

  const byTime = useMemo(() => {
    const map = new Map<string, Readout>();
    for (const point of candle.points) {
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
  }, [candle.points]);

  const latest = candle.points[candle.points.length - 1] ?? null;
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

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#35d399",
      downColor: "#ff6b76",
      borderUpColor: "#35d399",
      borderDownColor: "#ff6b76",
      wickUpColor: "#35d399",
      wickDownColor: "#ff6b76",
      priceLineColor: accent,
      priceLineWidth: 2,
      priceFormat: { type: "price", precision: currency === "INR" ? 2 : 2, minMove: 0.01 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      borderVisible: false,
    });

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
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
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [accent, byTime, candleData, currency, volumeData]);

  return (
    <div className="relative overflow-hidden rounded-md border border-[#293039] bg-[#0d1115]">
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
        Scroll to zoom · drag to pan
      </div>
    </div>
  );
}
