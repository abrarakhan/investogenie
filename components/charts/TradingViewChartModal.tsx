"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import CandleChartPro from "@/components/market-overview/CandleChartPro";
import type { OverviewCandle } from "@/lib/marketOverview";
import IntradayChart from "@/components/charts/IntradayChart";
import type { IntradaySeries } from "@/lib/intradayAggregate";

export interface ChartSymbol {
  ticker: string;
  exchange: string;
}

export type ChartGestureProps = HTMLAttributes<HTMLElement>;

const INTERACTIVE_SELECTOR = "a,button,input,select,textarea,summary,form,[data-chart-ignore]";
const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE_PX = 12;

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

function tradingViewSymbol({ ticker, exchange }: ChartSymbol): string {
  const cleanTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  const cleanExchange = exchange.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${cleanExchange}:${cleanTicker}`;
}

function tradingViewUrl(symbol: ChartSymbol): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingViewSymbol(symbol))}`;
}

export function useTradingViewChart() {
  const [chart, setChart] = useState<ChartSymbol | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  const closeChart = useCallback(() => setChart(null), []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const bindChartGesture = useCallback((symbol: ChartSymbol): ChartGestureProps => ({
    title: `Double-click or long-press to open ${symbol.ticker} chart`,
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      setChart(symbol);
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if ((event.pointerType !== "touch" && event.pointerType !== "pen") || isInteractiveTarget(event.target)) return;
      cancelLongPress();
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        start.current = null;
        setChart(symbol);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (!start.current) return;
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_TOLERANCE_PX) cancelLongPress();
    },
    onPointerUp: cancelLongPress,
    onPointerCancel: cancelLongPress,
  }), [cancelLongPress]);

  return { chart, closeChart, bindChartGesture };
}

export default function TradingViewChartModal({ chart, onClose }: { chart: ChartSymbol | null; onClose: () => void }) {
  const [chartData, setChartData] = useState<{ key: string; candle: OverviewCandle | null; error: string | null } | null>(null);
  const market = chart && ["NSE", "BSE"].includes(chart.exchange.trim().toUpperCase()) ? "IN" : "US";
  const requestKey = chart ? `${market}:${chart.exchange.trim().toUpperCase()}:${chart.ticker.trim().toUpperCase()}` : "";
  const currentData = chartData?.key === requestKey ? chartData : null;
  const candle = currentData?.candle ?? null;
  const error = currentData?.error ?? null;
  const loading = Boolean(chart) && currentData === null;
  const [view, setView] = useState<"DAILY" | "INTRADAY">("DAILY");
  const [sessions, setSessions] = useState(1);
  const [intradayData, setIntradayData] = useState<{ key: string; series: IntradaySeries | null; error: string | null } | null>(null);
  const intradayKey = `${requestKey}:${sessions}`;
  const intraday = intradayData?.key === intradayKey ? intradayData : null;
  const showIntraday = market === "IN" && view === "INTRADAY";
  const externalUrl = useMemo(() => chart ? tradingViewUrl(chart) : "https://www.tradingview.com/", [chart]);

  useEffect(() => {
    if (!chart) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [chart, onClose]);

  useEffect(() => {
    if (!chart) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ market, ticker: chart.ticker, exchange: chart.exchange, days: "800" });
    fetch(`/api/market-overview/candles?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Chart request failed (${response.status})`);
        return response.json() as Promise<{ candle?: OverviewCandle | null; error?: string }>;
      })
      .then((payload) => {
        if (!payload.candle?.points.length) throw new Error(payload.error ?? "No OHLCV history is available for this stock.");
        setChartData({ key: requestKey, candle: payload.candle, error: null });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setChartData({ key: requestKey, candle: null, error: reason instanceof Error ? reason.message : "Could not load this chart." });
      });
    return () => controller.abort();
  }, [chart, market, requestKey]);

  useEffect(() => {
    if (!chart || !showIntraday) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ ticker: chart.ticker, exchange: chart.exchange, sessions: String(sessions) });
    fetch(`/api/market-overview/intraday?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Chart request failed (${response.status})`);
        return response.json() as Promise<{ series?: IntradaySeries | null; error?: string }>;
      })
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        setIntradayData({ key: intradayKey, series: payload.series ?? null, error: null });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setIntradayData({ key: intradayKey, series: null, error: reason instanceof Error ? reason.message : "Could not load this chart." });
      });
    return () => controller.abort();
  }, [chart, showIntraday, sessions, intradayKey]);

  if (!chart) return null;
  const tab = (active: boolean) => `inline-flex min-h-10 items-center rounded-lg border px-3 text-xs font-semibold ${active ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100" : "border-white/15 text-white/55 hover:bg-white/10"}`;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={`${chart.ticker} candlestick chart`} className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-white/15 bg-[#080b12] shadow-2xl">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4">
          <div>
            <div className="font-bold">{chart.ticker}</div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">{chart.exchange} · InvestoGenie {showIntraday ? "1-minute candles" : "daily OHLCV"}</div>
          </div>
          <div className="flex items-center gap-2">
            {market === "IN" && (
              <>
                <button type="button" onClick={() => setView("DAILY")} className={tab(!showIntraday)}>Daily</button>
                <button type="button" onClick={() => setView("INTRADAY")} className={tab(showIntraday)}>Intraday</button>
              </>
            )}
            <a href={externalUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-lg border border-cyan-400/25 px-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10">Open in TradingView</a>
            <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-lg border border-white/15 px-4 text-sm font-semibold text-white/75 hover:bg-white/10">Close</button>
          </div>
        </header>
        <div className="min-h-[470px] overflow-auto p-2 sm:p-4">
          {showIntraday && !intraday && <div className="flex min-h-[430px] items-center justify-center text-sm text-white/45">Loading {chart.ticker} 1-minute candles…</div>}
          {showIntraday && intraday?.error && <div className="flex min-h-[430px] items-center justify-center px-6 text-center text-sm text-amber-100/75">{intraday.error}</div>}
          {showIntraday && intraday && !intraday.error && !intraday.series && (
            <div className="flex min-h-[430px] items-center justify-center px-6 text-center text-sm leading-relaxed text-white/50">
              No 1-minute candles are stored for {chart.ticker}. They are kept for about a week, and only for stocks on the live price feed.
            </div>
          )}
          {showIntraday && intraday?.series && <IntradayChart series={intraday.series} sessions={sessions} onSessionsChange={setSessions} />}
          {!showIntraday && loading && <div className="flex min-h-[430px] items-center justify-center text-sm text-white/45">Loading {chart.ticker} candles…</div>}
          {!showIntraday && error && <div className="flex min-h-[430px] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-amber-100/75"><p>{error}</p><a href={externalUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-cyan-400/25 px-4 py-2 font-semibold text-cyan-200">Open in TradingView</a></div>}
          {!showIntraday && candle && <CandleChartPro candle={candle} accent="#22d3ee" currency={market === "IN" ? "INR" : "USD"} />}
        </div>
      </section>
    </div>
  );
}
