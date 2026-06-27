"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  FundamentalLeader,
  MarketOverviewData,
  OverviewQuote,
  OverviewSeries,
} from "@/lib/marketOverview";

const META = {
  US: {
    label: "U.S. Markets",
    short: "US",
    flag: "US",
    accent: "#43b5ff",
    accentSoft: "#172a38",
    zone: "America/New_York",
    currency: "USD",
    chartColors: ["#43b5ff", "#a78bfa", "#f59e0b"],
  },
  IN: {
    label: "India Markets",
    short: "IN",
    flag: "IN",
    accent: "#f6b94b",
    accentSoft: "#302617",
    zone: "Asia/Kolkata",
    currency: "INR",
    chartColors: ["#f6b94b", "#35d399", "#43b5ff"],
  },
} as const;

const RANGE_POINTS = { "5D": 5, "1M": 22, "3M": 66, "6M": 132, "1Y": 260 } as const;
type Range = keyof typeof RANGE_POINTS;

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

function QuoteRows({ rows, currency }: { rows: OverviewQuote[]; currency: string }) {
  if (!rows.length) return <Empty label="No live quotes" />;
  return (
    <div className="divide-y divide-[#242a31]">
      {rows.map((row) => (
        <div key={`${row.exchange}:${row.ticker}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2 text-xs hover:bg-white/[0.025]">
          <div className="min-w-0">
            <div className="truncate font-semibold text-white/85">{row.ticker}</div>
            <div className="truncate text-[10px] text-white/35">{row.name}</div>
          </div>
          <span className="tabular-nums text-white/70">{money(row.price, currency)}</span>
          <Change value={row.changePct} />
        </div>
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-4 py-8 text-center text-xs text-white/35">{label}</div>;
}

function normalized(series: OverviewSeries, points: number) {
  const slice = series.points.slice(-points);
  const base = slice[0]?.close ?? 0;
  return slice.map((point) => ({
    date: point.date,
    value: base ? ((point.close - base) / base) * 100 : 0,
  }));
}

function Performance({
  series,
  quotes,
  colors,
}: {
  series: OverviewSeries[];
  quotes: OverviewQuote[];
  colors: readonly string[];
}) {
  const [range, setRange] = useState<Range>("1M");
  const [hover, setHover] = useState<number | null>(null);
  const lines = useMemo(
    () => series.map((item) => ({ ticker: item.ticker, points: normalized(item, RANGE_POINTS[range]) })),
    [series, range],
  );
  const values = lines.flatMap((line) => line.points.map((point) => point.value));
  const low = Math.min(-1, ...values);
  const high = Math.max(1, ...values);
  const span = high - low || 1;
  const width = 720;
  const height = 260;
  const left = 46;
  const right = 18;
  const top = 18;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  return (
    <Panel
      title={series.length ? "Normalized performance" : "One-day leader performance"}
      action={series.length ? (
        <div className="flex gap-1">
          {(Object.keys(RANGE_POINTS) as Range[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              className={`rounded px-2 py-1 text-[10px] font-semibold ${range === value ? "bg-[var(--overview-accent)] text-black" : "text-white/45 hover:bg-white/5"}`}
            >
              {value}
            </button>
          ))}
        </div>
      ) : undefined}
    >
      {series.length ? (
        <div className="relative p-3">
          <div className="mb-2 flex flex-wrap gap-4 text-[11px]">
            {lines.map((line, index) => {
              const pointIndex = hover === null
                ? line.points.length - 1
                : Math.min(line.points.length - 1, Math.round(hover * Math.max(0, line.points.length - 1)));
              const value = line.points[pointIndex]?.value ?? 0;
              return (
                <span key={line.ticker} className="flex items-center gap-1.5 text-white/60">
                  <i className="h-2 w-2 rounded-sm" style={{ background: colors[index] }} />
                  {line.ticker} <b className="tabular-nums text-white/90">{pct(value)}</b>
                </span>
              );
            })}
          </div>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[260px] w-full"
            role="img"
            aria-label="Normalized market performance chart"
            onMouseMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setHover(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)));
            }}
            onMouseLeave={() => setHover(null)}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = top + ratio * plotHeight;
              const label = high - ratio * span;
              return (
                <g key={ratio}>
                  <line x1={left} x2={width - right} y1={y} y2={y} stroke="#293039" strokeWidth="1" />
                  <text x={left - 7} y={y + 4} fill="#75808c" fontSize="10" textAnchor="end">{label.toFixed(1)}%</text>
                </g>
              );
            })}
            {lines.map((line, index) => {
              const path = line.points.map((point, pointIndex) => {
                const x = left + (pointIndex / Math.max(1, line.points.length - 1)) * plotWidth;
                const y = top + ((high - point.value) / span) * plotHeight;
                return `${x},${y}`;
              }).join(" ");
              return <polyline key={line.ticker} points={path} fill="none" stroke={colors[index]} strokeWidth="2.2" strokeLinejoin="round" />;
            })}
            {hover !== null && (
              <line x1={left + hover * plotWidth} x2={left + hover * plotWidth} y1={top} y2={height - bottom} stroke="#d9e1e8" strokeDasharray="3 4" opacity="0.5" />
            )}
          </svg>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          {quotes.map((item) => {
            const value = item.changePct ?? 0;
            return (
              <div key={item.ticker} className="grid grid-cols-[50px_1fr_64px] items-center gap-3 text-xs">
                <span className="font-semibold">{item.ticker}</span>
                <div className="h-2 overflow-hidden rounded-sm bg-[#252b32]">
                  <div className="h-full bg-[var(--overview-accent)]" style={{ width: `${Math.min(100, Math.abs(value) * 12 + 8)}%`, opacity: value < 0 ? 0.45 : 1 }} />
                </div>
                <Change value={item.changePct} />
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function CandidateRows({ data, currency }: { data: MarketOverviewData["candidates"]; currency: string }) {
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
              <td className="px-3 py-2.5 font-semibold text-white/85">{row.ticker}</td>
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

function FundamentalRows({ rows }: { rows: FundamentalLeader[] }) {
  if (!rows.length) return <Empty label="Fundamentals are syncing" />;
  return (
    <div className="divide-y divide-[#242a31]">
      {rows.map((row) => (
        <div key={row.ticker} className="grid grid-cols-[1fr_58px_58px] gap-2 px-3 py-2.5 text-xs">
          <div><b className="text-white/85">{row.ticker}</b><div className="mt-0.5 text-[10px] text-white/35">P/E {row.peRatio?.toFixed(1) ?? "-"}</div></div>
          <div className="text-right"><span className="text-[10px] text-white/35">ROCE</span><div className="tabular-nums text-[#47d7a1]">{pct(row.roce, 1)}</div></div>
          <div className="text-right"><span className="text-[10px] text-white/35">Sales</span><div className="tabular-nums"><Change value={row.salesGrowth} /></div></div>
        </div>
      ))}
    </div>
  );
}

export default function MarketOverview({ data }: { data: MarketOverviewData }) {
  const meta = META[data.market];
  const other = data.market === "US" ? "in" : "us";
  const [clock, setClock] = useState("");
  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat("en-GB", {
      timeZone: meta.zone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [meta.zone]);

  const totalBreadth = data.breadth.advancers + data.breadth.decliners + data.breadth.unchanged;
  const advanceWidth = totalBreadth ? data.breadth.advancers / totalBreadth * 100 : 0;
  const declineWidth = totalBreadth ? data.breadth.decliners / totalBreadth * 100 : 0;

  return (
    <div
      className="min-h-screen bg-[#090c0f] text-[#e7ebef]"
      style={{ "--overview-accent": meta.accent, "--overview-soft": meta.accentSoft } as React.CSSProperties}
    >
      <header className="sticky top-0 z-40 border-b border-[#293039] bg-[#0d1115]/95 backdrop-blur">
        <div className="flex min-h-14 items-center gap-4 px-4 lg:px-6">
          <Link href="/" className="shrink-0 text-base font-black tracking-tight">Investo<span className="text-[var(--overview-accent)]">Genie</span></Link>
          <div className="hidden h-6 w-px bg-[#303740] sm:block" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{meta.label} Overview</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Live intelligence workspace</div>
          </div>
          <div className="hidden items-center gap-2 text-xs md:flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#47d7a1]" />
            <span className="text-white/45">Market clock</span>
            <span className="font-mono text-white/80">{clock || "--:--:--"}</span>
          </div>
          <div className="flex rounded-md border border-[#303740] p-0.5 text-xs">
            <Link href={`/markets/${data.market.toLowerCase()}`} className="rounded px-3 py-1.5 font-bold text-black" style={{ background: meta.accent }}>{meta.short}</Link>
            <Link href={`/markets/${other}`} className="rounded px-3 py-1.5 text-white/50 hover:bg-white/5">{other.toUpperCase()}</Link>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden w-16 shrink-0 border-r border-[#293039] bg-[#0d1115] lg:block">
          <nav className="sticky top-14 flex flex-col items-center gap-2 py-4 text-[10px] text-white/40">
            <Link title="Overview" href={`/markets/${data.market.toLowerCase()}`} className="grid h-10 w-10 place-items-center rounded-md bg-[var(--overview-soft)] font-bold text-[var(--overview-accent)]">OV</Link>
            <Link title="Swing Candidates" href={`/terminal/${data.market.toLowerCase()}/screener`} className="grid h-10 w-10 place-items-center rounded-md hover:bg-white/5 hover:text-white">SW</Link>
            <Link title="Terminal" href={`/terminal/${data.market.toLowerCase()}`} className="grid h-10 w-10 place-items-center rounded-md hover:bg-white/5 hover:text-white">TR</Link>
            <Link title="Settings" href="/settings" className="grid h-10 w-10 place-items-center rounded-md hover:bg-white/5 hover:text-white">ST</Link>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-3 lg:p-4">
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            {data.quotes.map((item) => (
              <div key={item.ticker} className="rounded-md border border-[#293039] bg-[#12161b] px-4 py-3">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40"><span>{item.name}</span><span>{item.exchange}</span></div>
                <div className="mt-1 flex items-end justify-between gap-3"><strong className="text-xl tabular-nums">{money(item.price, meta.currency)}</strong><Change value={item.changePct} /></div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
            <div className="space-y-3">
              <Panel title="Top gainers"><QuoteRows rows={data.gainers} currency={meta.currency} /></Panel>
              <Panel title="Top decliners"><QuoteRows rows={data.losers} currency={meta.currency} /></Panel>
            </div>

            <div className="min-w-0 space-y-3">
              <Performance series={data.series} quotes={data.quotes} colors={meta.chartColors} />
              <Panel title="Swing candidates" action={<Link href={`/terminal/${data.market.toLowerCase()}/screener`} className="text-[10px] font-semibold text-[var(--overview-accent)]">View all</Link>}>
                <CandidateRows data={data.candidates} currency={meta.currency} />
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
              <Panel title="Fundamental leaders"><FundamentalRows rows={data.fundamentals} /></Panel>
              <Panel title="Data coverage">
                <div className="grid grid-cols-3 divide-x divide-[#293039] py-4 text-center">
                  <div><b className="block text-lg tabular-nums">{data.coverage.quoted.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">Quotes</span></div>
                  <div><b className="block text-lg tabular-nums">{data.coverage.history.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">History</span></div>
                  <div><b className="block text-lg tabular-nums">{data.coverage.fundamentals.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">Fund.</span></div>
                </div>
              </Panel>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
