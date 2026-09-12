"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import MatchStatusBadge from "@/components/ui/MatchStatusBadge";
import type { FundMappingData, SnapshotWithMapping, UserFundMappingRow } from "@/lib/funds/fundMappingStore";
import type { FundComposition, PairwiseOverlap, StockExposure } from "@/lib/analytics/fundOverlap";
import { acceptFundSuggestion, autoAcceptIsinMatches, rejectFundSuggestion, unlinkFundMapping } from "./actions";
import GmailDisclosurePanel from "@/components/funds/GmailDisclosurePanel";
import type { GmailDisclosureData } from "@/lib/gmail/disclosures";

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

/** Fund-pair overlap: "Fund A ↔ Fund B — X% — these exact stocks".
 *  Lives here as well as on the terminal X-Ray because this is the screen where
 *  mapping decisions are made — seeing the overlap a mapping produced is the
 *  payoff for accepting it, and the reason to go find the next disclosure. */
function OverlapPairs({ pairs, matched, compositions }: { pairs: PairwiseOverlap[]; matched: number; compositions: FundComposition[] }) {
  const [expanded, setExpanded] = useState<string | null>(pairs[0] ? `${pairs[0].fundA}|${pairs[0].fundB}` : null);
  const weights = useMemo(() => new Map(compositions.map((fund) => [
    fund.fundTicker,
    new Map(fund.stocks.map((stock) => [stock.stockTicker, stock.weightPct])),
  ])), [compositions]);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Fund vs fund overlap</p>
          <p className="mt-1 text-[11px] text-white/40">
            How much of each pair&apos;s holdings are the same stocks, and exactly which ones.
          </p>
        </div>
        {pairs.length > 0 && (
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/50">
            {pairs.length} pair{pairs.length === 1 ? "" : "s"} from {matched} mapped fund{matched === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {pairs.length === 0 ? (
        <p className="text-sm text-white/45">
          {matched < 2
            ? `Overlap needs at least two mapped funds to compare — ${matched} mapped so far. Accept a suggestion below (or import that fund's AMC disclosure) to unlock this.`
            : "No shared stocks between the mapped funds yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {pairs.map((pair) => {
            const key = `${pair.fundA}|${pair.fundB}`;
            const isOpen = expanded === key;
            const heavy = pair.overlapPct >= 30;
            return (
              <div key={key} className="rounded-lg border border-white/5 bg-black/20">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : key)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="block truncate text-white/80" title={`${pair.fundA} ↔ ${pair.fundB}`}>
                      {pair.fundA} <span className="text-white/35">↔</span> {pair.fundB}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-white/38">
                      {pair.sharedStocks.length} shared stock{pair.sharedStocks.length === 1 ? "" : "s"}
                      {heavy && " · heavy duplication"}
                    </span>
                  </span>
                  <span className={heavy ? "font-mono text-sm font-bold text-rose-300" : "font-mono text-sm text-cyan-200"}>
                    {pair.overlapPct.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-white/30">{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-white/5 px-3 py-2.5">
                    <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 px-2 text-[9px] uppercase tracking-wide text-white/30">
                      <span>Common stock</span><span>Fund A</span><span>Fund B</span><span>Overlap</span>
                    </div>
                    <div className="max-h-72 space-y-1 overflow-auto">
                      {pair.sharedStocks.map((stock) => {
                        const weightA = weights.get(pair.fundA)?.get(stock) ?? 0;
                        const weightB = weights.get(pair.fundB)?.get(stock) ?? 0;
                        return (
                          <div key={stock} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 rounded-md border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1.5 text-[10px]">
                            <span className="truncate font-semibold text-amber-100" title={stock}>{stock}</span>
                            <span className="font-mono text-white/65">{weightA.toFixed(2)}%</span>
                            <span className="font-mono text-white/65">{weightB.toFixed(2)}%</span>
                            <span className="font-mono text-cyan-100">{Math.min(weightA, weightB).toFixed(2)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SharedStocks({ stocks }: { stocks: StockExposure[] }) {
  const shared = stocks
    .filter((stock) => stock.contributingFunds.length > 1)
    .sort((a, b) => b.effectiveWeightPct - a.effectiveWeightPct);
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Common stocks across my funds</p>
          <p className="mt-1 text-[11px] text-white/40">Combined percentage of your total mutual-fund portfolio exposed to each repeated stock.</p>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/50">{shared.length} shared</span>
      </div>
      {shared.length === 0 ? (
        <p className="text-sm text-white/45">No common stocks are available yet. More mapped AMC snapshots are required.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {shared.map((stock) => (
            <div key={stock.stockTicker} className="rounded-lg border border-amber-300/15 bg-amber-300/[0.07] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs font-semibold text-amber-100" title={stock.stockTicker}>{stock.stockTicker}</span>
                <span className="font-mono text-xs font-bold text-cyan-100">{stock.effectiveWeightPct.toFixed(2)}%</span>
              </div>
              <p className="mt-1 truncate text-[10px] text-white/42" title={stock.contributingFunds.join(", ")}>{stock.contributingFunds.join(" · ")}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function FundMappingClient({
  data,
  linkedStocks,
  pairwiseOverlaps = [],
  fundCompositions = [],
  stockExposure = [],
  gmail,
  gmailStatus,
}: {
  data: FundMappingData;
  linkedStocks?: string | null;
  pairwiseOverlaps?: PairwiseOverlap[];
  fundCompositions?: FundComposition[];
  stockExposure?: StockExposure[];
  gmail: GmailDisclosureData;
  gmailStatus?: string | null;
}) {
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
      {gmailStatus && ["denied", "invalid_state", "failed"].includes(gmailStatus) && (
        <div className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
          Gmail connection failed or was cancelled. No mailbox access was stored.
        </div>
      )}
      {data.summary.unidentified > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300/25 bg-amber-300/[0.08] px-4 py-3 text-sm text-amber-50 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {data.summary.unidentified} imported fund {data.summary.unidentified === 1 ? "row is" : "rows are"} missing an ISIN, so automatic AMC matching is intentionally blocked for those rows. Re-import the latest CAS to restore complete scheme identities.
          </span>
          <Link href="/terminal/in/cas" className="shrink-0 rounded-md border border-amber-200/25 px-3 py-1.5 text-xs font-bold text-amber-100">
            Re-import latest CAS
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-[var(--ig-accent)]/25 bg-[var(--ig-accent)]/[0.07] p-4 sm:col-span-2 xl:col-span-1"><p className="text-[10px] uppercase tracking-[0.16em] text-white/40">Overall fund value</p><p className="mt-1 text-2xl font-black text-white">{money(data.summary.totalValue)}</p></div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Funds</p><p className="mt-1 text-2xl font-black">{data.summary.imported}</p></div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Matched</p><p className="mt-1 text-2xl font-black text-emerald-300">{data.summary.matched}</p></div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Pending</p><p className="mt-1 text-2xl font-black text-amber-300">{data.summary.pending}</p></div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Common stocks</p><p className="mt-1 text-2xl font-black text-amber-200">{stockExposure.filter((stock) => stock.contributingFunds.length > 1).length}</p></div>
      </div>

      <SharedStocks stocks={stockExposure} />
      <OverlapPairs pairs={pairwiseOverlaps} matched={data.summary.matched} compositions={fundCompositions} />

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

      <GmailDisclosurePanel gmail={gmail} funds={data.funds} />
    </div>
  );
}
