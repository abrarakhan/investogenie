"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FIELDS, DEFAULT_COLUMNS } from "@/lib/screener/fields";
import type { Filter, SortSpec } from "@/lib/screener/filterEngine";
import { type Preset } from "@/lib/screener/presets";
import type { ScreenerStock, ScreenResult, Market } from "@/lib/screener/service";
import {
  addToWatchlistById, saveScreen, deleteScreen, renameScreen, type SavedScreen,
} from "@/app/screener/actions";
import FilterPanel from "./FilterPanel";
import ResultsTable, { type HeldPosition } from "./ResultsTable";
import { exportCsv, exportExcel } from "./exportData";

interface MarketMeta { sectors: string[]; universes: string[] }

interface Props {
  isAuthed: boolean;
  initialMarket: Market;
  meta: Record<Market, MarketMeta>;
  holdings: Record<Market, Record<string, HeldPosition>>;
  watchlist: Record<Market, string[]>;
  initial: ScreenResult;
  savedScreens: SavedScreen[];
}

const PAGE_SIZES = [25, 50, 100, 200, 500];
const DEFAULT_SORT: SortSpec = { field: "market_cap", dir: "desc" };
const UNIVERSE_LABEL: Record<string, string> = {
  ALL: "All stocks", NIFTY_50: "Nifty 50", NIFTY_100: "Nifty 100", NIFTY_500: "Nifty 500",
  FNO: "F&O", SP_500: "S&P 500",
};

function formatSnapshotStamp(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function StockScreener(props: Props) {
  const [market, setMarket] = useState<Market>(props.initialMarket);
  const [universe, setUniverse] = useState("ALL");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [valueFlag, setValueFlag] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(DEFAULT_COLUMNS);
  const [colMenuOpen, setColMenuOpen] = useState(false);

  const [result, setResult] = useState<ScreenResult>(props.initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(props.watchlist[props.initialMarket] ?? []);
  const [saved, setSaved] = useState<SavedScreen[]>(props.savedScreens);

  const reqId = useRef(0);
  const isFirst = useRef(true);

  const runQuery = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/screener", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ market, universe, filters, sort, search, page, pageSize, valueBelowSectorMedian: valueFlag }),
      });
      const data = await res.json();
      if (id !== reqId.current) return; // stale response
      if (!res.ok) { setError(data.error || "Query failed"); return; }
      setResult(data as ScreenResult);
    } catch {
      if (id === reqId.current) setError("Network error");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [market, universe, filters, sort, search, page, pageSize, valueFlag]);

  // Debounced live update (~300ms) on any query input change. Skip the first
  // render since the server already provided the initial result.
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    const t = setTimeout(runQuery, 300);
    return () => clearTimeout(t);
  }, [runQuery]);

  const visibleColumns = useMemo(
    () => FIELDS.filter((f) => f.key === "symbol" || visibleKeys.includes(f.key)),
    [visibleKeys],
  );

  const applyPreset = (p: Preset) => {
    setFilters(p.filters);
    setSort(p.sort ?? DEFAULT_SORT);
    setValueFlag(p.dynamic === "value");
    setActivePreset(p.key);
    setPage(1);
  };

  const addFilter = (f: Filter) => { setFilters((prev) => [...prev, f]); setActivePreset(null); setPage(1); };
  const removeFilter = (i: number) => { setFilters((prev) => prev.filter((_, idx) => idx !== i)); setActivePreset(null); setPage(1); };
  const clearFilters = () => { setFilters([]); setValueFlag(false); setActivePreset(null); setPage(1); };

  const onSort = (field: string) => {
    setSort((prev) => (prev.field === field ? { field, dir: prev.dir === "asc" ? "desc" : "asc" } : { field, dir: "desc" }));
    setPage(1);
  };

  const switchMarket = (m: Market) => {
    if (m === market) return;
    setMarket(m); setUniverse("ALL"); setPage(1);
    setWatchlist(props.watchlist[m] ?? []);
  };

  const onAddWatchlist = async (row: ScreenerStock) => {
    setWatchlist((prev) => (prev.includes(row.symbol) ? prev : [...prev, row.symbol]));
    try { await addToWatchlistById(row.asset_id); } catch { /* optimistic; ignore */ }
  };

  const onSaveScreen = async () => {
    const name = window.prompt("Save this screen as:");
    if (!name) return;
    try {
      setSaved(await saveScreen({ name, market, universe, filters, sort, columns: visibleKeys, valueBelowSectorMedian: valueFlag }));
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
  };

  const loadScreen = (s: SavedScreen) => {
    setMarket(s.market === "US" ? "US" : "IN");
    setUniverse(s.universe || "ALL");
    setFilters(s.filters || []);
    setSort(s.sort || DEFAULT_SORT);
    setValueFlag(Boolean((s.sort as unknown as { valueBelowSectorMedian?: boolean })?.valueBelowSectorMedian));
    if (s.columns?.length) setVisibleKeys(s.columns);
    setActivePreset(null);
    setPage(1);
    setWatchlist(props.watchlist[s.market === "US" ? "US" : "IN"] ?? []);
  };

  const marketMeta = props.meta[market];
  const holdings = props.holdings[market] ?? {};
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const asOf = result.refreshedAt ? formatSnapshotStamp(result.refreshedAt) : null;

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-white/15">
          {(["IN", "US"] as Market[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMarket(m)}
              className={`px-3 py-1.5 text-sm ${market === m ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/5"}`}
            >
              {m === "IN" ? "🇮🇳 India" : "🇺🇸 US"}
            </button>
          ))}
        </div>

        <select value={universe} onChange={(e) => { setUniverse(e.target.value); setPage(1); }} className="rounded-lg border border-white/15 bg-[#0a0e17] px-3 py-1.5 text-sm text-white/80">
          {marketMeta.universes.map((u) => <option key={u} value={u}>{UNIVERSE_LABEL[u] ?? u}</option>)}
        </select>

        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search symbol / name"
          className="min-w-[180px] flex-1 rounded-lg border border-white/15 bg-[#0a0e17] px-3 py-1.5 text-sm text-white/80"
        />

        {/* Column chooser */}
        <div className="relative">
          <button onClick={() => setColMenuOpen((v) => !v)} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5">Columns</button>
          {colMenuOpen && (
            <div className="absolute right-0 z-20 mt-1 max-h-80 w-56 overflow-auto rounded-lg border border-white/15 bg-[#0a0e17] p-2 shadow-xl">
              {FIELDS.filter((f) => f.key !== "symbol").map((f) => (
                <label key={f.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-white/70 hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={visibleKeys.includes(f.key)}
                    onChange={(e) => setVisibleKeys((prev) => e.target.checked ? [...prev, f.key] : prev.filter((k) => k !== f.key))}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => exportCsv(result.rows, visibleColumns, `screener-${market}`)} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5">CSV</button>
        <button onClick={() => exportExcel(result.rows, visibleColumns, `screener-${market}`)} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5">Excel</button>

        {props.isAuthed && (
          <>
            <button onClick={onSaveScreen} className="rounded-lg border border-[var(--ig-accent,#22d3ee)]/40 px-3 py-1.5 text-sm text-white/80 hover:bg-[var(--ig-accent,#22d3ee)]/10">Save screen</button>
            {saved.length > 0 && (
              <select
                onChange={(e) => { const s = saved.find((x) => x.id === e.target.value); if (s) loadScreen(s); e.target.value = ""; }}
                defaultValue=""
                className="rounded-lg border border-white/15 bg-[#0a0e17] px-3 py-1.5 text-sm text-white/80"
              >
                <option value="" disabled>Saved screens…</option>
                {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </>
        )}
      </div>

      {/* Saved-screen management row */}
      {props.isAuthed && saved.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/50">
          <span className="uppercase tracking-wide text-white/30">Saved</span>
          {saved.map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
              <button className="hover:text-white" onClick={() => loadScreen(s)}>{s.name}</button>
              <button className="text-white/30 hover:text-white/70" title="Rename" onClick={async () => { const n = window.prompt("Rename screen", s.name); if (n) setSaved(await renameScreen(s.id, n)); }}>✎</button>
              <button className="text-white/30 hover:text-rose-400" title="Delete" onClick={async () => { if (window.confirm(`Delete "${s.name}"?`)) setSaved(await deleteScreen(s.id)); }}>×</button>
            </span>
          ))}
        </div>
      )}

      <FilterPanel
        sectors={marketMeta.sectors}
        activeFilters={filters}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilter}
        onClearFilters={clearFilters}
        activePreset={activePreset}
        onApplyPreset={applyPreset}
      />

      {/* Result meta */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
        <div>
          {loading ? "Loading…" : `${result.total.toLocaleString()} match${result.total === 1 ? "" : "es"}`}
          {valueFlag && <span className="ml-2 text-[var(--ig-accent,#22d3ee)]">· P/E below sector median</span>}
          {error && <span className="ml-2 text-rose-400">· {error}</span>}
        </div>
        {asOf && <div>Snapshot as of {asOf}</div>}
      </div>

      {loading && result.rows.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-white/5" />)}
        </div>
      ) : (
        <ResultsTable
          rows={result.rows}
          columns={visibleColumns}
          sort={sort}
          onSort={onSort}
          holdings={holdings}
          watchlist={watchlist}
          onAddWatchlist={onAddWatchlist}
          loading={loading}
        />
      )}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/50">
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded border border-white/15 bg-[#0a0e17] px-2 py-1 text-white/80">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-white/15 px-2 py-1 disabled:opacity-30 hover:enabled:bg-white/5">Prev</button>
          <span>Page {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded border border-white/15 px-2 py-1 disabled:opacity-30 hover:enabled:bg-white/5">Next</button>
        </div>
      </div>
    </div>
  );
}
