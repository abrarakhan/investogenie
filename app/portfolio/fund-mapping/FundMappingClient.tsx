"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import MatchStatusBadge from "@/components/ui/MatchStatusBadge";
import type { FundMappingData, SnapshotWithMapping, UserFundMappingRow } from "@/lib/funds/fundMappingStore";
import { acceptFundSuggestion, autoAcceptIsinMatches, rejectFundSuggestion, unlinkFundMapping } from "./actions";

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function field(value: string | null | undefined) {
  return value && value.trim() ? value : "-";
}

function FundCard({ fund, selected, onSelect }: { fund: UserFundMappingRow; selected: boolean; onSelect: () => void }) {
  const suggestion = fund.suggestion.candidates[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${selected ? "border-[var(--ig-accent)] bg-[var(--ig-accent)]/10" : "border-white/10 bg-white/[0.025] hover:bg-white/[0.05]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white" title={fund.fundName}>{fund.fundName}</p>
          <p className="mt-1 text-xs text-white/42">ISIN {field(fund.isin)} · AMC {field(fund.amc)}</p>
        </div>
        <MatchStatusBadge status={fund.displayStatus} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="font-mono text-white/70">{money(fund.currentValue)}</span>
        {suggestion && fund.displayStatus !== "matched" && (
          <span className="truncate text-cyan-200/80">{fund.suggestion.reason}</span>
        )}
      </div>
    </button>
  );
}

function ActionButton({ children, formAction, pendingLabel, confirm }: { children: React.ReactNode; formAction: (data: FormData) => void; pendingLabel?: string; confirm?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(event) => {
        const form = event.currentTarget.form;
        if (!form) return;
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(form);
        startTransition(() => formAction(data));
      }}
      className="rounded-md border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs font-semibold text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
    >
      {pending ? pendingLabel ?? "Working..." : children}
    </button>
  );
}

function SnapshotCard({ snapshot, selectedFund }: { snapshot: SnapshotWithMapping; selectedFund: UserFundMappingRow | null }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white/86" title={snapshot.name}>{snapshot.name}</p>
          <p className="mt-1 text-xs text-white/42">{field(snapshot.amc)} · {field(snapshot.category)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">{snapshot.holdingCount} rows</span>
      </div>
      <div className="mt-3 grid gap-1 text-xs text-white/50 sm:grid-cols-2">
        <span>ISIN <b className="font-mono text-white/70">{field(snapshot.isin)}</b></span>
        <span>Month <b className="font-mono text-white/70">{field(snapshot.snapshotMonth)}</b></span>
      </div>
      {snapshot.mappedFundName && (
        <p className="mt-3 rounded-md border border-emerald-300/15 bg-emerald-300/5 px-2 py-1.5 text-xs text-emerald-200/80">
          Already linked to {snapshot.mappedFundName}
        </p>
      )}
      {selectedFund && selectedFund.displayStatus !== "matched" && (
        <form className="mt-3">
          <input type="hidden" name="holdingId" value={selectedFund.holdingId} />
          <input type="hidden" name="schemeCode" value={snapshot.schemeCode} />
          <input type="hidden" name="method" value="manual" />
          <input type="hidden" name="confidence" value="1" />
          <ActionButton formAction={acceptFundSuggestion} pendingLabel="Linking..." confirm={`Map ${selectedFund.fundName} -> ${snapshot.name}?`}>
            Link to selected fund
          </ActionButton>
        </form>
      )}
    </div>
  );
}

export default function FundMappingClient({ data, linkedStocks }: { data: FundMappingData; linkedStocks?: string | null }) {
  const [selectedId, setSelectedId] = useState(data.funds.find((fund) => fund.displayStatus !== "matched")?.holdingId ?? data.funds[0]?.holdingId ?? null);
  const [query, setQuery] = useState("");
  const [amcFilter, setAmcFilter] = useState("all");
  const [autoPending, startAuto] = useTransition();
  const selectedFund = data.funds.find((fund) => fund.holdingId === selectedId) ?? null;
  const exactCount = data.funds.filter((fund) => fund.suggestion.method === "isin_exact" && fund.displayStatus !== "matched").length;

  const amcs = useMemo(() => [...new Set(data.snapshots.map((s) => s.amc).filter(Boolean) as string[])].sort(), [data.snapshots]);
  const visibleSnapshots = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.snapshots.filter((snapshot) => {
      const haystack = `${snapshot.name} ${snapshot.isin ?? ""} ${snapshot.amc ?? ""} ${snapshot.category ?? ""}`.toLowerCase();
      const amcOk = amcFilter !== "all" ? snapshot.amc === amcFilter : true;
      return amcOk && (!q || haystack.includes(q));
    });
  }, [amcFilter, data.snapshots, query]);

  return (
    <div className="space-y-5">
      {linkedStocks && (
        <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
          Linked — X-Ray now covers {linkedStocks} stocks for this fund.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Imported</p><p className="mt-1 text-2xl font-black">{data.summary.imported}</p></div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Matched</p><p className="mt-1 text-2xl font-black text-emerald-300">{data.summary.matched}</p></div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Pending</p><p className="mt-1 text-2xl font-black text-amber-300">{data.summary.pending}</p></div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Rejected</p><p className="mt-1 text-2xl font-black text-rose-300">{data.summary.rejected}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={autoPending || exactCount === 0}
          onClick={() => {
            if (window.confirm(`Auto-accept ${exactCount} exact ISIN match${exactCount === 1 ? "" : "es"}?`)) startAuto(() => autoAcceptIsinMatches());
          }}
          className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-45"
        >
          {autoPending ? "Accepting..." : `Auto-accept all ISIN matches (${exactCount})`}
        </button>
        <a href="/portfolio/fund-mapping/export" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/72 hover:bg-white/[0.08]">Export mapping status</a>
        <Link href="/terminal/in/cas" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/72 hover:bg-white/[0.08]">Import AMC disclosure</Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.25fr]">
        <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-black">My Funds</h2>
            <span className="text-xs text-white/40">Actionable funds first</span>
          </div>
          <div className="space-y-3">
            {data.funds.map((fund) => {
              const candidate = fund.suggestion.candidates[0];
              return (
                <div key={fund.holdingId} className="space-y-2">
                  <FundCard fund={fund} selected={selectedId === fund.holdingId} onSelect={() => setSelectedId(fund.holdingId)} />
                  {selectedId === fund.holdingId && fund.displayStatus !== "matched" && candidate && (
                    <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/5 p-3 text-xs text-white/60">
                      <p><b className="text-cyan-100">Suggested:</b> {candidate.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <form>
                          <input type="hidden" name="holdingId" value={fund.holdingId} />
                          <input type="hidden" name="schemeCode" value={candidate.schemeCode} />
                          <input type="hidden" name="method" value={fund.suggestion.method} />
                          <input type="hidden" name="confidence" value={fund.suggestion.confidence ?? 0} />
                          <ActionButton formAction={acceptFundSuggestion} pendingLabel="Accepting...">Accept</ActionButton>
                        </form>
                        <form>
                          <input type="hidden" name="holdingId" value={fund.holdingId} />
                          <input type="hidden" name="schemeCode" value={candidate.schemeCode} />
                          <ActionButton formAction={rejectFundSuggestion} pendingLabel="Rejecting...">Reject</ActionButton>
                        </form>
                      </div>
                    </div>
                  )}
                  {selectedId === fund.holdingId && fund.displayStatus === "matched" && (
                    <form className="px-1">
                      <input type="hidden" name="holdingId" value={fund.holdingId} />
                      <ActionButton formAction={unlinkFundMapping} pendingLabel="Unlinking..." confirm={`Unlink ${fund.fundName}?`}>Unlink</ActionButton>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black">Available Snapshots</h2>
              <p className="mt-1 text-xs text-white/40">Loaded AMC monthly portfolio disclosures</p>
            </div>
            <div className="flex gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search scheme, ISIN, AMC" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 sm:w-64" />
              <select value={amcFilter} onChange={(e) => setAmcFilter(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none">
                <option value="all">All AMCs</option>
                {amcs.map((amc) => <option key={amc} value={amc}>{amc}</option>)}
              </select>
            </div>
          </div>
          {selectedFund && selectedFund.displayStatus === "no_snapshot" && (
            <div className="mb-3 rounded-lg border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              No disclosure loaded for {selectedFund.amc ?? selectedFund.fundName}. Import the AMC monthly portfolio file to activate this fund.
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleSnapshots.map((snapshot) => <SnapshotCard key={snapshot.schemeCode} snapshot={snapshot} selectedFund={selectedFund} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
