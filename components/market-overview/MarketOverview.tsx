"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FundamentalLeader,
  MarketOverviewData,
  OverviewQuote,
  OverviewSeries,
} from "@/lib/marketOverview";

// WebGL is client-only; skip prerender. `ssr: false` is valid here because this
// is a Client Component (Next 16 requirement).
const PerformanceChart3D = dynamic(() => import("./PerformanceChart3D"), {
  ssr: false,
  loading: () => <div className="h-[300px] w-full animate-pulse rounded bg-white/[0.03]" />,
});

/** Max symbols plotted at once — beyond this the 3D stack gets unreadable. */
const MAX_SELECTED = 5;

const META = {
  US: {
    label: "U.S. Markets",
    short: "US",
    flag: "US",
    accent: "#43b5ff",
    accentSoft: "#172a38",
    zone: "America/New_York",
    currency: "USD",
    chartColors: ["#43b5ff", "#a78bfa", "#f59e0b", "#35d399", "#ff6b76"],
  },
  IN: {
    label: "India Markets",
    short: "IN",
    flag: "IN",
    accent: "#f6b94b",
    accentSoft: "#302617",
    zone: "Asia/Kolkata",
    currency: "INR",
    chartColors: ["#f6b94b", "#35d399", "#43b5ff", "#a78bfa", "#ff6b76"],
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

/** Accent bar + tint marking a row that is currently plotted on the chart. */
function selectionStyle(active: boolean, color?: string): React.CSSProperties {
  return active
    ? { boxShadow: `inset 3px 0 0 ${color ?? "var(--overview-accent)"}`, background: "rgba(255,255,255,0.045)" }
    : {};
}

function QuoteRows({
  rows, currency, selected, colorFor, onToggle,
}: {
  rows: OverviewQuote[];
  currency: string;
  selected: string[];
  colorFor: (ticker: string) => string | undefined;
  onToggle: (ticker: string) => void;
}) {
  if (!rows.length) return <Empty label="No live quotes" />;
  return (
    <div className="divide-y divide-[#242a31]">
      {rows.map((row) => {
        const active = selected.includes(row.ticker);
        return (
          <button
            key={`${row.exchange}:${row.ticker}`}
            type="button"
            onClick={() => onToggle(row.ticker)}
            aria-pressed={active}
            title={active ? `Remove ${row.ticker} from chart` : `Plot ${row.ticker} on the chart`}
            style={selectionStyle(active, colorFor(row.ticker))}
            className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.05]"
          >
            <div className="min-w-0">
              <div className="truncate font-semibold text-white/85">{row.ticker}</div>
              <div className="truncate text-[10px] text-white/35">{row.name}</div>
            </div>
            <span className="tabular-nums text-white/70">{money(row.price, currency)}</span>
            <Change value={row.changePct} />
          </button>
        );
      })}
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
  loading,
  onToggle,
}: {
  series: OverviewSeries[];
  quotes: OverviewQuote[];
  colors: readonly string[];
  loading: boolean;
  onToggle: (ticker: string) => void;
}) {
  const [range, setRange] = useState<Range>("1M");
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const lines = useMemo(
    () => series.map((item) => ({ ticker: item.ticker, points: normalized(item, RANGE_POINTS[range]) })),
    [series, range],
  );
  const values = lines.flatMap((line) => line.points.map((point) => point.value));
  const low = Math.min(-1, ...values);
  const high = Math.max(1, ...values);
  const ticks = useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((ratio) => high - ratio * (high - low || 1)),
    [low, high],
  );

  return (
    <Panel
      title={series.length ? "Normalized performance" : "One-day leader performance"}
      action={series.length ? (
        <div className="flex items-center gap-1">
          {loading && <span className="mr-1 h-2 w-2 animate-pulse rounded-full bg-[var(--overview-accent)]" />}
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
          {/* Legend doubles as the active-selection control: hover to spotlight,
              click x to drop the symbol from the plot. */}
          <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px]">
            {lines.map((line, index) => {
              const pointIndex = hover === null
                ? line.points.length - 1
                : Math.min(line.points.length - 1, Math.round(hover * Math.max(0, line.points.length - 1)));
              const value = line.points[pointIndex]?.value ?? 0;
              return (
                <span
                  key={line.ticker}
                  onMouseEnter={() => setFocus(line.ticker)}
                  onMouseLeave={() => setFocus(null)}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-white/60"
                >
                  <i className="h-2 w-2 rounded-sm" style={{ background: colors[index % colors.length] }} />
                  {line.ticker} <b className="tabular-nums text-white/90">{pct(value)}</b>
                  <button
                    type="button"
                    onClick={() => onToggle(line.ticker)}
                    className="ml-0.5 text-white/30 hover:text-[#ff6b76]"
                    title={`Remove ${line.ticker}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <span className="text-[10px] text-white/25">Click any symbol on the left or right to plot it · drag the chart to orbit</span>
          </div>

          <div
            className="relative h-[300px] w-full"
            onMouseMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setHover(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)));
            }}
            onMouseLeave={() => setHover(null)}
          >
            {/* Axis labels are billboarded sprites inside the scene so they
                track the camera as the user orbits — no HTML gutter here. */}
            <PerformanceChart3D
              lines={lines}
              colors={colors}
              low={low}
              high={high}
              ticks={ticks}
              hoverRatio={hover}
              focus={focus}
            />
          </div>
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

function FundamentalRows({
  rows, selected, colorFor, onToggle,
}: {
  rows: FundamentalLeader[];
  selected: string[];
  colorFor: (ticker: string) => string | undefined;
  onToggle: (ticker: string) => void;
}) {
  if (!rows.length) return <Empty label="Fundamentals are syncing" />;
  return (
    <div className="divide-y divide-[#242a31]">
      {rows.map((row) => {
        const active = selected.includes(row.ticker);
        return (
          <button
            key={row.ticker}
            type="button"
            onClick={() => onToggle(row.ticker)}
            aria-pressed={active}
            title={active ? `Remove ${row.ticker} from chart` : `Plot ${row.ticker} on the chart`}
            style={selectionStyle(active, colorFor(row.ticker))}
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

  // ---- Interactive chart selection -----------------------------------------
  // The server seeds a default trio; clicking any gainer / decliner /
  // fundamental leader toggles that symbol into the plot, fetching its history
  // on demand and caching it so re-selecting is instant.
  const [selected, setSelected] = useState<string[]>(() => data.series.map((s) => s.ticker));
  const [cache, setCache] = useState<Record<string, OverviewSeries>>(
    () => Object.fromEntries(data.series.map((s) => [s.ticker, s])),
  );
  const [loading, setLoading] = useState(false);

  // Tickers already requested (seeded ones count as done) so a symbol is only
  // ever fetched once, however many times it is toggled.
  const requested = useRef<Set<string>>(new Set(data.series.map((s) => s.ticker)));

  const ensureSeries = useCallback(async (ticker: string) => {
    if (requested.current.has(ticker)) return;
    requested.current.add(ticker);
    setLoading(true);
    try {
      const res = await fetch(`/api/market-overview/series?market=${data.market}&tickers=${ticker}`);
      const payload: { series?: OverviewSeries[] } = await res.json();
      if (payload.series?.length) {
        setCache((prev) => {
          const next = { ...prev };
          for (const s of payload.series!) next[s.ticker] = s;
          return next;
        });
      }
    } catch {
      // Allow a retry on the next click; the symbol simply stays unplotted.
      requested.current.delete(ticker);
    } finally {
      setLoading(false);
    }
  }, [data.market]);

  const toggleTicker = useCallback((ticker: string) => {
    setSelected((prev) => {
      if (prev.includes(ticker)) {
        // Never empty the chart entirely.
        return prev.length === 1 ? prev : prev.filter((t) => t !== ticker);
      }
      // At the cap, drop the oldest to make room (FIFO) so a click always works.
      return prev.length >= MAX_SELECTED ? [...prev.slice(1), ticker] : [...prev, ticker];
    });
    void ensureSeries(ticker);
  }, [ensureSeries]);

  const chartSeries = useMemo(
    () => selected.map((t) => cache[t]).filter((s): s is OverviewSeries => Boolean(s)),
    [selected, cache],
  );
  const colorFor = useCallback(
    (ticker: string) => {
      const i = chartSeries.findIndex((s) => s.ticker === ticker);
      return i === -1 ? undefined : meta.chartColors[i % meta.chartColors.length];
    },
    [chartSeries, meta.chartColors],
  );

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
            <Link title="Sync Status" href="/admin/sync" className="grid h-10 w-10 place-items-center rounded-md hover:bg-white/5 hover:text-white">SY</Link>
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
              <Panel title="Top gainers">
                <QuoteRows rows={data.gainers} currency={meta.currency} selected={selected} colorFor={colorFor} onToggle={toggleTicker} />
              </Panel>
              <Panel title="Top decliners">
                <QuoteRows rows={data.losers} currency={meta.currency} selected={selected} colorFor={colorFor} onToggle={toggleTicker} />
              </Panel>
            </div>

            <div className="min-w-0 space-y-3">
              <Performance
                series={chartSeries}
                quotes={data.quotes}
                colors={meta.chartColors}
                loading={loading}
                onToggle={toggleTicker}
              />
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
              <Panel title="Fundamental leaders">
                <FundamentalRows rows={data.fundamentals} selected={selected} colorFor={colorFor} onToggle={toggleTicker} />
              </Panel>
              <Panel title="Data freshness">
                <FreshnessRows data={data} />
              </Panel>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
