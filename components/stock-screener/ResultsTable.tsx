"use client";

import { Fragment, useState } from "react";
import type { FieldDef } from "@/lib/screener/fields";
import type { ScreenerStock } from "@/lib/screener/service";
import type { SortSpec } from "@/lib/screener/filterEngine";
import { FIELDS } from "@/lib/screener/fields";
import { PROVENANCE_BY_FIELD } from "@/lib/screener/provider";
import { formatValue, fmtPrice, fmtPct, signColor, DASH } from "./format";

export interface HeldPosition {
  quantity: number;
  avgCost: number | null;
}

interface Props {
  rows: ScreenerStock[];
  columns: FieldDef[]; // visible, in order (symbol pinned first)
  sort: SortSpec;
  onSort: (field: string) => void;
  holdings: Record<string, HeldPosition>; // symbol -> position
  watchlist: string[]; // symbols already on the watchlist
  onAddWatchlist: (row: ScreenerStock) => void;
  loading: boolean;
}

function cellFor(row: ScreenerStock, field: FieldDef): React.ReactNode {
  const value = (row as unknown as Record<string, number | string | null>)[field.key];
  if (field.key === "change_pct_1d" || field.key === "gap_pct") {
    return <span className={signColor(value as number | null)}>{fmtPct(value as number | null)}</span>;
  }
  if (field.key === "revenue_growth_yoy" || field.key === "profit_growth_yoy") {
    return <span className={signColor(value as number | null)}>{formatValue(value, field.format, row.currency)}</span>;
  }
  return <span className="text-white/80">{formatValue(value, field.format, row.currency)}</span>;
}

/** Where the current price sits inside its 52-week range. */
function RangeSlider({ row }: { row: ScreenerStock }) {
  const { low_52w: lo, high_52w: hi, ltp } = row;
  if (lo === null || hi === null || ltp === null || hi <= lo) {
    return <div className="text-xs text-white/40">52-week range unavailable</div>;
  }
  const pct = Math.min(100, Math.max(0, ((ltp - lo) / (hi - lo)) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-white/50">
        <span>52W L {fmtPrice(lo, row.currency)}</span>
        <span>52W H {fmtPrice(hi, row.currency)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-gradient-to-r from-rose-500/40 via-amber-500/40 to-emerald-500/50">
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--ig-accent,#22d3ee)] shadow"
          style={{ left: `${pct}%` }}
          title={`${pct.toFixed(0)}% of range`}
        />
      </div>
      <div className="mt-1 text-center text-[11px] text-white/60">
        {fmtPrice(ltp, row.currency)} · {pct.toFixed(0)}% of range
      </div>
    </div>
  );
}

function PortfolioBadge({ row, pos }: { row: ScreenerStock; pos: HeldPosition }) {
  const invested = pos.avgCost !== null ? pos.quantity * pos.avgCost : null;
  const current = row.ltp !== null ? pos.quantity * row.ltp : null;
  const pnl = invested !== null && current !== null ? current - invested : null;
  const pnlPct = pnl !== null && invested ? (pnl / invested) * 100 : null;
  return (
    <div className="rounded-lg border border-[var(--ig-accent,#22d3ee)]/30 bg-[var(--ig-accent,#22d3ee)]/5 p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ig-accent,#22d3ee)]">
        In your portfolio
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div><span className="text-white/40">Qty </span><span className="text-white/80">{pos.quantity}</span></div>
        <div><span className="text-white/40">Invested </span><span className="text-white/80">{invested === null ? DASH : fmtPrice(invested, row.currency)}</span></div>
        <div><span className="text-white/40">Current </span><span className="text-white/80">{current === null ? DASH : fmtPrice(current, row.currency)}</span></div>
        <div>
          <span className="text-white/40">P&amp;L </span>
          <span className={signColor(pnl)}>{pnl === null ? DASH : `${fmtPrice(pnl, row.currency)}${pnlPct !== null ? ` (${fmtPct(pnlPct)})` : ""}`}</span>
        </div>
      </div>
    </div>
  );
}

function tradingViewUrl(row: ScreenerStock): string {
  const ex = row.exchange === "NSE" ? "NSE" : row.exchange === "BSE" ? "BSE"
    : row.exchange === "NYSE" ? "NYSE" : row.exchange === "NASDAQ" ? "NASDAQ" : row.exchange;
  return `https://www.tradingview.com/symbols/${ex}-${encodeURIComponent(row.symbol)}/`;
}

function ExpandedRow({
  row, colSpan, held, onWatch, onWatchlisted,
}: {
  row: ScreenerStock; colSpan: number; held?: HeldPosition; onWatch: () => void; onWatchlisted: boolean;
}) {
  // Every fundamental field, shown regardless of column visibility.
  const detailFields = FIELDS.filter((f) => f.key !== "symbol");
  return (
    <tr className="bg-black/30">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-white">{row.name || row.symbol}</span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">{row.exchange}</span>
              {row.sector && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">{row.sector}</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
              {detailFields.map((f) => {
                const v = (row as unknown as Record<string, number | string | null>)[f.key];
                return (
                  <div key={f.key} className="flex justify-between gap-2 border-b border-white/5 pb-1">
                    <span className="text-white/40" title={PROVENANCE_BY_FIELD[f.key]?.note}>{f.label}</span>
                    <span className="text-white/80">{formatValue(v, f.format, row.currency)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="space-y-3">
            <RangeSlider row={row} />
            {held && <PortfolioBadge row={row} pos={held} />}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onWatch}
                disabled={onWatchlisted}
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {onWatchlisted ? "On watchlist ✓" : "+ Watchlist"}
              </button>
              <a
                href={tradingViewUrl(row)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                Open chart ↗
              </a>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function ResultsTable({
  rows, columns, sort, onSort, holdings, watchlist, onAddWatchlist, loading,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const watchSet = new Set(watchlist);
  const colSpan = columns.length + 1; // + expander column

  if (!loading && rows.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-white/10 bg-white/[0.02] py-20 text-center">
        <div>
          <div className="text-lg font-semibold text-white/80">No stocks match these filters</div>
          <div className="mt-1 text-sm text-white/40">Loosen a filter or clear the screen to see more results.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-[#0a0e17]">
          <tr className="text-left text-[11px] uppercase tracking-wide text-white/40">
            <th className="w-8 px-2 py-3"></th>
            {columns.map((c, i) => (
              <th
                key={c.key}
                onClick={() => c.sortable && onSort(c.key)}
                className={`whitespace-nowrap px-3 py-3 font-medium ${c.sortable ? "cursor-pointer hover:text-white/70" : ""} ${
                  i === 0 ? "sticky left-0 z-10 bg-[#0a0e17]" : ""
                } ${c.type === "number" ? "text-right" : "text-left"}`}
              >
                {c.label}
                {sort.field === c.key && <span className="ml-1 text-[var(--ig-accent,#22d3ee)]">{sort.dir === "asc" ? "▲" : "▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={loading ? "opacity-50" : ""}>
          {rows.map((row) => {
            const isOpen = expanded === row.asset_id;
            return (
              <Fragment key={row.asset_id}>
                <tr className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-2 py-2.5 text-center">
                    <button
                      onClick={() => setExpanded(isOpen ? null : row.asset_id)}
                      className="text-white/40 hover:text-white"
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      {isOpen ? "−" : "+"}
                    </button>
                  </td>
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={`whitespace-nowrap px-3 py-2.5 ${i === 0 ? "sticky left-0 bg-[#05070d] font-semibold text-white" : ""} ${
                        c.type === "number" ? "text-right tabular-nums" : "text-left"
                      }`}
                    >
                      {i === 0 ? (
                        <span className="flex items-center gap-1.5">
                          {row.symbol}
                          {holdings[row.symbol] && <span className="h-1.5 w-1.5 rounded-full bg-[var(--ig-accent,#22d3ee)]" title="In portfolio" />}
                        </span>
                      ) : (
                        cellFor(row, c)
                      )}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <ExpandedRow
                    row={row}
                    colSpan={colSpan}
                    held={holdings[row.symbol]}
                    onWatch={() => onAddWatchlist(row)}
                    onWatchlisted={watchSet.has(row.symbol)}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
