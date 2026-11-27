"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatPct, formatPrice } from "@/lib/markets";
import type { MarketId } from "@/lib/types";
import type {
  SectorThrustGroupLevel,
  SectorThrustGroupStatus,
  SectorThrustGroupView,
  SectorThrustSnapshot,
} from "@/lib/sectorThrustTypes";

function groupStatusTone(status: SectorThrustGroupStatus): string {
  if (status === "ACTIVE") return "border-emerald-400/35 bg-emerald-500/15 text-emerald-300";
  if (status === "FADED") return "border-amber-400/35 bg-amber-500/15 text-amber-300";
  if (status === "WATCH") return "border-sky-400/25 bg-sky-500/10 text-sky-300";
  return "border-white/20 bg-white/10 text-white/65";
}

function formatTimeShort(iso: string | null, market: MarketId): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(market === "IN" ? "en-IN" : "en-US", {
    timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function SectorThrustPanel({
  snapshot,
  market,
}: {
  snapshot: SectorThrustSnapshot;
  market: MarketId;
}) {
  const [levelFilter, setLevelFilter] = useState<"ALL" | SectorThrustGroupLevel>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "TRIGGERED" | "UNVERIFIED">("ALL");
  const m = market.toLowerCase();

  const visibleGroups = useMemo(() => {
    return snapshot.groups.filter((g) => {
      if (levelFilter !== "ALL" && g.groupLevel !== levelFilter) return false;
      if (statusFilter === "TRIGGERED" && g.status !== "ACTIVE" && g.status !== "FADED") return false;
      if (statusFilter === "UNVERIFIED" && g.status !== "UNVERIFIED") return false;
      return true;
    });
  }, [snapshot.groups, levelFilter, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Run status & coverage summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-xs">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                snapshot.status === "LIVE" || snapshot.status === "EOD"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                  : snapshot.status === "STALE"
                    ? "border-amber-400/35 bg-amber-500/15 text-amber-300"
                    : "border-white/20 bg-white/10 text-white/70"
              }`}
            >
              {snapshot.status}
            </span>
            <span className="text-white/70">
              {snapshot.activeGroupCount} active · {snapshot.fadedGroupCount} faded · {snapshot.unverifiedGroupCount} unverified
            </span>
            {snapshot.sessionDate && (
              <span className="font-mono text-white/45">
                Session {snapshot.sessionDate} · {formatTimeShort(snapshot.checkpointAt, market)}
              </span>
            )}
          </div>
          {snapshot.unverifiedReason && (
            <p className="text-amber-200/80">{snapshot.unverifiedReason}</p>
          )}
          <div className="text-white/45">
            Universe: {snapshot.eligibleUniverseCount} eligible liquid stocks · {snapshot.unclassifiedCount} unclassified ·
            observation-only (no push alerts).
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(["ALL", "INDUSTRY", "SECTOR"] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevelFilter(lvl)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                levelFilter === lvl
                  ? "border-[var(--ig-accent)] bg-[var(--ig-accent)]/15 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"
              }`}
            >
              {lvl === "ALL" ? "All Groups" : lvl === "INDUSTRY" ? "Industries" : "Broad Sectors"}
            </button>
          ))}
          {(["ALL", "TRIGGERED", "UNVERIFIED"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                statusFilter === st
                  ? "border-white/30 bg-white/15 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"
              }`}
            >
              {st === "ALL" ? "All Status" : st === "TRIGGERED" ? "Active/Faded" : "Unverified"}
            </button>
          ))}
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/50">
          {snapshot.groups.length === 0
            ? snapshot.unverifiedReason || "No Sector Thrust checkpoint available yet."
            : "No sector or industry groups match the selected filter."}
        </div>
      ) : (
        <div className="grid gap-3">
          {visibleGroups.map((g: SectorThrustGroupView) => {
            const priceCovPct = g.eligibleCount > 0 ? Math.round((g.priceFreshCount / g.eligibleCount) * 100) : 0;
            const volCovPct = g.eligibleCount > 0 ? Math.round((g.volumeFreshCount / g.eligibleCount) * 100) : 0;
            return (
              <article
                key={`${g.groupLevel}:${g.groupKey}`}
                className="rounded-xl border border-white/10 bg-white/[0.025] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-white">{g.groupLabel}</span>
                      <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase text-white/55">
                        {g.groupLevel === "INDUSTRY" ? "Industry" : "Broad Sector"}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${groupStatusTone(g.status)}`}>
                        {g.status}
                      </span>
                      {g.firstTriggeredAt && (
                        <span className="font-mono text-[11px] text-emerald-300/85">
                          First trigger {formatTimeShort(g.firstTriggeredAt, market)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/50">
                      {g.parentSector ? `Parent: ${g.parentSector} · ` : ""}
                      Fresh price {g.priceFreshCount}/{g.eligibleCount} ({priceCovPct}%) ·
                      Fresh vol {g.volumeFreshCount}/{g.eligibleCount} ({volCovPct}%) ·
                      Qualifying leaders {g.qualifyingCount}/{g.eligibleCount}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-xs">
                    <div className="rounded-lg bg-black/30 px-2.5 py-1.5 text-right">
                      <div className="text-[9px] uppercase text-white/40">Median Move</div>
                      <div className={(g.medianReturnPct ?? 0) >= 0 ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>
                        {g.medianReturnPct !== null ? formatPct(g.medianReturnPct) : "--"}
                      </div>
                    </div>
                    <div className="rounded-lg bg-black/30 px-2.5 py-1.5 text-right">
                      <div className="text-[9px] uppercase text-white/40">Median Pace</div>
                      <div className="font-semibold text-white/85">
                        {g.medianRvol !== null ? `${g.medianRvol.toFixed(2)}x` : "--"}
                      </div>
                    </div>
                  </div>
                </div>

                {g.unverifiedReason && (
                  <p className="mt-2 text-xs text-amber-200/80">{g.unverifiedReason}</p>
                )}

                {g.relatedNews.length > 0 && (
                  <div className="mt-3 space-y-1 rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-200/90">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-300/80">
                      Related news (observation-only)
                    </div>
                    {g.relatedNews.map((n, i) => (
                      <div key={i} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="truncate">{n.title}</span>
                        <span className="shrink-0 text-[10px] text-sky-300/70">
                          {n.source}
                          {n.publishedAt ? ` · ${formatTimeShort(n.publishedAt, market)}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {(g.leaders.length > 0 || g.catchUp.length > 0) && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-300/85">
                        Leaders ({g.leaders.length})
                      </div>
                      {g.leaders.length === 0 ? (
                        <div className="text-xs text-white/40">No qualifying leaders.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {g.leaders.slice(0, 6).map((mem) => (
                            <div key={mem.assetId} className="flex items-center justify-between gap-2 text-xs">
                              <div className="min-w-0 truncate">
                                <Link
                                  href={`/terminal/${m}/stocks?search=${encodeURIComponent(mem.ticker)}`}
                                  className="font-semibold text-white hover:text-[var(--ig-accent)]"
                                >
                                  {mem.ticker}
                                </Link>
                                <span className="ml-1.5 text-[11px] text-white/45">
                                  {mem.rvol !== null ? `${mem.rvol.toFixed(1)}x` : "--"}
                                  {mem.atrExtension !== null ? ` · ${mem.atrExtension.toFixed(1)} ATR` : ""}
                                </span>
                              </div>
                              <div className="shrink-0 font-mono">
                                <span className="text-white/75">{formatPrice(mem.price, market)}</span>
                                <span className="ml-2 font-semibold text-emerald-400">{formatPct(mem.returnPct)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-sky-300/85">
                        Catch-Up Watch ≤ 1.0 ATR ({g.catchUp.length})
                      </div>
                      {g.catchUp.length === 0 ? (
                        <div className="text-xs text-white/40">No liquid names currently in the ≤ 1.0 ATR catch-up band.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {g.catchUp.slice(0, 6).map((mem) => (
                            <div key={mem.assetId} className="flex items-center justify-between gap-2 text-xs">
                              <div className="min-w-0 truncate">
                                <Link
                                  href={`/terminal/${m}/stocks?search=${encodeURIComponent(mem.ticker)}`}
                                  className="font-semibold text-white hover:text-[var(--ig-accent)]"
                                >
                                  {mem.ticker}
                                </Link>
                                <span className="ml-1.5 text-[11px] text-white/45">
                                  {mem.atrExtension !== null ? `${mem.atrExtension.toFixed(2)} ATR` : "--"}
                                  {mem.rvol !== null ? ` · ${mem.rvol.toFixed(1)}x` : ""}
                                </span>
                              </div>
                              <div className="shrink-0 font-mono">
                                <span className="text-white/75">{formatPrice(mem.price, market)}</span>
                                <span className="ml-2 font-semibold text-sky-300">{formatPct(mem.returnPct)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
