"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { FundamentalLeader, MarketOverviewData, OverviewQuote } from "@/lib/marketOverview";
import TradingViewChartModal, { type ChartSymbol } from "@/components/charts/TradingViewChartModal";

const META = {
  US: {
    label: "U.S. Markets",
    short: "US",
    flag: "US",
    accent: "#43b5ff",
    accentSoft: "#172a38",
    zone: "America/New_York",
    currency: "USD",
  },
  IN: {
    label: "India Markets",
    short: "IN",
    flag: "IN",
    accent: "#f6b94b",
    accentSoft: "#302617",
    zone: "Asia/Kolkata",
    currency: "INR",
  },
} as const;


function money(value: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value < 100 ? 2 : 0,
  }).format(value);
}

const pct = (value: number | null, digits = 2) =>
  value === null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;

function Change({ value }: { value: number | null }) {
  const tone = value === null ? "text-white/35" : value >= 0 ? "text-[#47d7a1]" : "text-[#ff6b76]";
  return <span className={`tabular-nums ${tone}`}>{pct(value)}</span>;
}

function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-md border border-[#293039] bg-[#12161b] ${className}`}>
      <div className="flex min-h-10 items-center justify-between border-b border-[#293039] px-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-white/75">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function QuoteRows({ rows, currency, onChart }: {
  rows: OverviewQuote[];
  currency: string;
  onChart: (row: OverviewQuote) => void;
}) {
  if (!rows.length) return <Empty label="No live quotes" />;
  return (
    <div className="divide-y divide-[#242a31]">
      {rows.map((row) => (
        <button key={`${row.exchange}:${row.ticker}`} type="button" onClick={() => onChart(row)}
          className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-left text-xs hover:bg-white/[0.05]">
          <span className="min-w-0">
            <span className="block truncate font-semibold text-white/85">{row.ticker}</span>
            <span className="block truncate text-[10px] text-white/35">{row.name}</span>
          </span>
          <span className="tabular-nums text-white/70">{money(row.price, currency)}</span>
          <Change value={row.changePct} />
        </button>
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-4 py-8 text-center text-xs text-white/35">{label}</div>;
}


function CandidateRows({ data, currency, onChart }: { data: MarketOverviewData["candidates"]; currency: string; onChart: (ticker: string) => void }) {
  if (!data.length) return <Empty label="No active buy candidates" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-[#0e1216] text-[10px] uppercase tracking-wider text-white/35">
          <tr><th className="px-3 py-2 text-left">Ticker</th><th className="px-3 py-2 text-right">Current</th><th className="px-3 py-2 text-right">Entry</th><th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-right">Score</th></tr>
        </thead>
        <tbody className="divide-y divide-[#242a31]">
          {data.map((row) => (
            <tr key={row.ticker} className="hover:bg-white/[0.025]">
              <td className="px-3 py-2.5 font-semibold text-white/85"><button type="button" onClick={() => onChart(row.ticker)}>{row.ticker}</button></td>
              <td className="px-3 py-2.5 text-right tabular-nums text-white/65">{row.current === null ? "-" : money(row.current, currency)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.entry === null ? "-" : money(row.entry, currency)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#47d7a1]">{row.target === null ? "-" : money(row.target, currency)}</td>
              <td className="px-3 py-2.5 text-right"><span className="rounded bg-[var(--overview-soft)] px-2 py-1 font-bold text-[var(--overview-accent)]">{Math.round(row.score * 100)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FundamentalRows({
  rows, onChart,
}: {
  rows: FundamentalLeader[];
  onChart: (ticker: string) => void;
}) {
  if (!rows.length) return <Empty label="Fundamentals are syncing" />;
  return (
    <div className="divide-y divide-[#242a31]">
      {rows.map((row) => {
        return (
          <button
            key={row.ticker}
            type="button"
            onClick={() => onChart(row.ticker)}
            className="grid w-full grid-cols-[1fr_58px_58px] gap-2 px-3 py-2.5 text-left text-xs transition-colors hover:bg-white/[0.05]"
          >
            <div><b className="text-white/85">{row.ticker}</b><div className="mt-0.5 text-[10px] text-white/35">P/E {row.peRatio?.toFixed(1) ?? "-"}</div></div>
            <div className="text-right"><span className="text-[10px] text-white/35">ROCE</span><div className="tabular-nums text-[#47d7a1]">{pct(row.roce, 1)}</div></div>
            <div className="text-right"><span className="text-[10px] text-white/35">Sales</span><div className="tabular-nums"><Change value={row.salesGrowth} /></div></div>
          </button>
        );
      })}
    </div>
  );
}

function formatStamp(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status: string | null): string {
  if (!status) return "bg-white/10 text-white/40";
  return status === "ok" ? "bg-[#47d7a1]/15 text-[#47d7a1]" : "bg-[#ff6b76]/15 text-[#ff6b76]";
}

function FreshnessRows({ data }: { data: MarketOverviewData }) {
  const rows = [
    { label: "Quote date", value: data.freshness.latestQuoteAsOf ?? "-", sub: `DB ${formatStamp(data.freshness.latestQuoteUpdatedAt)}` },
    { label: "OHLCV date", value: data.freshness.latestHistoryDate ?? "-", sub: `${data.coverage.history.toLocaleString()} symbols` },
    { label: "Financials", value: data.freshness.latestFundamentalsPeriod ?? "-", sub: `DB ${formatStamp(data.freshness.latestFundamentalsUpdatedAt)}` },
    { label: "Last scan", value: formatStamp(data.freshness.lastScanAt), status: data.freshness.lastScanStatus },
    { label: "Quote sync", value: formatStamp(data.freshness.lastQuoteSyncAt), status: data.freshness.lastQuoteSyncStatus },
    { label: "History sync", value: formatStamp(data.freshness.lastHistorySyncAt), status: data.freshness.lastHistorySyncStatus },
  ];
  return (
    <div>
      <div className="grid grid-cols-3 divide-x divide-[#293039] py-4 text-center">
        <div><b className="block text-lg tabular-nums">{data.coverage.quoted.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">Quotes</span></div>
        <div><b className="block text-lg tabular-nums">{data.coverage.history.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">History</span></div>
        <div><b className="block text-lg tabular-nums">{data.coverage.fundamentals.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">Fund.</span></div>
      </div>
      <div className="divide-y divide-[#242a31] border-t border-[#293039]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
            <span className="text-white/45">{row.label}</span>
            <span className="min-w-0 text-right">
              <span className="block truncate font-mono text-white/80">{row.value}</span>
              {row.status ? (
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] uppercase ${statusTone(row.status)}`}>{row.status}</span>
              ) : (
                <span className="block truncate text-[10px] text-white/30">{row.sub}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MarketOverview({ data }: { data: MarketOverviewData }) {
  const meta = META[data.market];
  const [selectedChart, setSelectedChart] = useState<ChartSymbol | null>(null);
  const chartPanel = useRef<HTMLDivElement>(null);
  const defaultQuote = data.quotes[0] ?? data.gainers[0] ?? data.losers[0];
  const defaultTicker = data.series[0]?.ticker ?? defaultQuote?.ticker;
  const chart = selectedChart?.market === data.market ? selectedChart : defaultTicker
    ? { ticker: defaultTicker, exchange: defaultQuote?.ticker === defaultTicker ? defaultQuote.exchange : "", market: data.market }
    : null;
  const openStockChart = (ticker: string, exchange = "") => {
    setSelectedChart({ ticker, exchange, market: data.market });
    chartPanel.current?.scrollIntoView({ block: "nearest" });
  };
  const openQuoteChart = (quote: OverviewQuote) => openStockChart(quote.ticker, quote.exchange);

  const totalBreadth = data.breadth.advancers + data.breadth.decliners + data.breadth.unchanged;
  const advanceWidth = totalBreadth ? data.breadth.advancers / totalBreadth * 100 : 0;
  const declineWidth = totalBreadth ? data.breadth.decliners / totalBreadth * 100 : 0;

  return (
    <div
      className="text-[#e7ebef]"
      style={{ "--overview-accent": meta.accent, "--overview-soft": meta.accentSoft } as React.CSSProperties}
    >
      <div className="min-w-0">
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            {data.quotes.map((item) => (
              <button key={item.ticker} type="button" aria-label={`Open ${item.ticker} chart`} onClick={() => openQuoteChart(item)} className="rounded-md border border-[#293039] bg-[#12161b] px-4 py-3 text-left">
                <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/40">
                  <span>{item.name} · {item.exchange}</span>
                </div>
                <div className="mt-1 flex items-end justify-between gap-3"><strong className="text-xl tabular-nums">{money(item.price, meta.currency)}</strong><Change value={item.changePct} /></div>
              </button>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
            <div className="space-y-3">
              <Panel title="Top gainers">
                <QuoteRows rows={data.gainers} currency={meta.currency} onChart={openQuoteChart} />
              </Panel>
              <Panel title="Top decliners">
                <QuoteRows rows={data.losers} currency={meta.currency} onChart={openQuoteChart} />
              </Panel>
            </div>

            <div className="min-w-0 space-y-3">
              <div ref={chartPanel}>
                {chart ? <TradingViewChartModal key={`${chart.market}:${chart.exchange}:${chart.ticker}`} chart={chart} /> : (
                  <Panel title="Stock chart"><Empty label="No market symbols available" /></Panel>
                )}
              </div>
              <Panel title="Swing candidates" action={<Link href={`/terminal/${data.market.toLowerCase()}/screener`} className="text-[10px] font-semibold text-[var(--overview-accent)]">View all</Link>}>
                <CandidateRows data={data.candidates} currency={meta.currency} onChart={openStockChart} />
              </Panel>
            </div>

            <div className="space-y-3">
              <Panel title="Market breadth">
                <div className="p-4">
                  <div className="mb-3 flex justify-between text-xs"><span className="text-[#47d7a1]">{data.breadth.advancers} advancing</span><span className="text-[#ff6b76]">{data.breadth.decliners} declining</span></div>
                  <div className="flex h-3 overflow-hidden rounded-sm bg-[#303740]">
                    <div className="bg-[#47d7a1]" style={{ width: `${advanceWidth}%` }} />
                    <div className="bg-[#ff6b76]" style={{ width: `${declineWidth}%` }} />
                  </div>
                  <div className="mt-2 text-right text-[10px] text-white/35">{data.breadth.unchanged} unchanged / unavailable</div>
                </div>
              </Panel>
              <Panel title="Fundamental leaders">
                <FundamentalRows rows={data.fundamentals} onChart={openStockChart} />
              </Panel>
              <Panel title="Data freshness">
                <FreshnessRows data={data} />
              </Panel>
            </div>
          </div>
      </div>
    </div>
  );
}
