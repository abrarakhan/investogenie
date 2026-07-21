"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FreshnessBadge from "@/components/ui/FreshnessBadge";
import type { BackfillStatusSummary } from "@/lib/backfill/types";
import type { CoverageGap, DataHealthPageData, HealthSeverity } from "@/lib/dataHealth";

const SEVERITY: Record<HealthSeverity, string> = {
  critical: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  high: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  low: "border-white/10 bg-white/5 text-white/45",
};

function stamp(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function duration(value: number | null): string {
  if (value === null) return "-";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

function commandFor(gap: CoverageGap): string {
  if (gap.action === "Go to Fund Mapping") return "/portfolio/fund-mapping";
  if (gap.action === "Sync quotes") return "npm run dev or POST /api/cron/refresh-quotes with CRON_SECRET";
  if (gap.action === "Sync fundamentals") return gap.market === "US" ? "npm run sync:us-fundamentals" : "npm run sync:fundamentals";
  if (gap.action === "Backfill history") return gap.market === "US" ? "npm run sync:us-history" : "npm run sync:nse-history";
  return gap.action;
}

function ActionCell({ gap }: { gap: CoverageGap }) {
  const command = commandFor(gap);
  if (command.startsWith("/")) {
    return <Link href={command} className="text-cyan-200 underline decoration-cyan-200/30 underline-offset-4">{gap.action}</Link>;
  }
  return <span>{command}</span>;
}

export default function DataHealthClient({ data }: { data: DataHealthPageData }) {
  const router = useRouter();
  const [pendingAction, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<BackfillStatusSummary>(data.backfill);
  const [watchBackfill, setWatchBackfill] = useState(data.backfill.running);
  const [watchStartedAt, setWatchStartedAt] = useState<number | null>(null);
  const [market, setMarket] = useState("ALL");
  const [severity, setSeverity] = useState("all");
  const [issueType, setIssueType] = useState("all");
  const [job, setJob] = useState("all");
  const [status, setStatus] = useState("all");
  const issueTypes = useMemo(() => [...new Set(data.gaps.map((gap) => gap.issueType))].sort(), [data.gaps]);
  const jobs = useMemo(() => [...new Set(data.recentRuns.map((run) => run.job))].sort(), [data.recentRuns]);
  const gaps = data.gaps.filter((gap) =>
    (market === "ALL" || gap.market === market) &&
    (severity === "all" || gap.severity === severity) &&
    (issueType === "all" || gap.issueType === issueType),
  );
  const runs = data.recentRuns.filter((run) => (job === "all" || run.job === job) && (status === "all" || run.status === status));
  const quoteNoHistoryCount = data.quoteNoHistoryCount;

  const refreshBackfillStatus = useCallback(async () => {
    const res = await fetch("/api/backfill/status", { cache: "no-store" });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; status?: BackfillStatusSummary };
    if (res.ok && body.ok !== false && body.status) {
      setBackfill(body.status);
      return body.status;
    }
    return null;
  }, []);

  useEffect(() => {
    if (!watchBackfill && !backfill.running) return;
    let cancelled = false;
    const tick = async () => {
      const next = await refreshBackfillStatus();
      if (!cancelled && next && !next.running) {
        const stillStarting = watchStartedAt !== null && Date.now() - watchStartedAt < 15_000;
        if (!stillStarting) {
          setWatchBackfill(false);
          setWatchStartedAt(null);
          router.refresh();
        }
      }
    };
    const timer = window.setInterval(tick, 5_000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watchBackfill, backfill.running, refreshBackfillStatus, router, watchStartedAt]);

  const postBackfill = (url: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(url, { method: "POST" });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; summary?: { started?: boolean; message?: string; processed?: number; succeeded?: number; failed?: number; skipped?: number }; count?: number };
      if (!res.ok || body.ok === false) setMessage(body.error ?? `Request failed (${res.status})`);
      else if (url.endsWith("/run")) {
        setMessage(body.summary?.message ?? "Backfill started in the background. You can move to other screens; progress will continue here.");
        setWatchBackfill(true);
        setWatchStartedAt(Date.now());
      }
      else if (url.endsWith("/requeue-failed")) setMessage(`Re-queued ${body.count ?? 0} failed symbols.`);
      else setMessage("Backfill queue populated.");
      await refreshBackfillStatus();
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {data.sources.map((source) => (
          <section key={source.source} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-black text-white/90">{source.source}</h2>
              <FreshnessBadge status={source.status} />
            </div>
            <p className="mt-3 text-2xl font-black tabular-nums">{source.recordCount.toLocaleString("en-IN")}</p>
            <p className="mt-1 text-xs text-white/40">Last success {stamp(source.lastSuccessAt)}</p>
            <p className="mt-3 text-xs text-white/34">{source.detail}</p>
          </section>
        ))}
      </div>

      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-black">Backfill Status</h2>
              {backfill.running && <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200" />Running</span>}
            </div>
            <p className="mt-1 text-sm text-white/42">
              {backfill.total.toLocaleString("en-IN")} queued · {backfill.pending.toLocaleString("en-IN")} pending · {backfill.done.toLocaleString("en-IN")} done · {backfill.failed.toLocaleString("en-IN")} failed
            </p>
            <p className="mt-1 text-xs text-white/35">
              Lowest pending tier {backfill.lowestPendingTier ?? "-"} · Estimated remaining {backfill.estimatedMinutesRemaining === null ? "-" : `${backfill.estimatedMinutesRemaining.toFixed(1)} min`}
            </p>
            {backfill.active.length > 0 && <p className="mt-2 text-xs text-cyan-100/70">Now loading {backfill.active.map((item) => `${item.symbol} · T${item.tier}`).join(", ")}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pendingAction || backfill.running}
              onClick={() => postBackfill("/api/backfill/run", `This will start a background backfill batch from Tier ${backfill.lowestPendingTier ?? "-"}. You can keep using the app while it runs. Start now?`)}
              className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-45"
            >
              {backfill.running ? "Backfill running..." : pendingAction ? "Starting..." : "Run Backfill Now"}
            </button>
            <button type="button" disabled={pendingAction} onClick={() => postBackfill("/api/backfill/populate")} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/72 disabled:opacity-45">Populate Queue</button>
            <button type="button" disabled={pendingAction || backfill.failed === 0} onClick={() => postBackfill("/api/backfill/requeue-failed", `Re-queue ${backfill.failed} failed symbols for retry?`)} className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-45">Re-queue Failed</button>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300" style={{ width: `${Math.max(0, Math.min(100, backfill.percentDone))}%` }} />
        </div>
        <p className="mt-2 text-right text-xs font-mono text-white/38">{backfill.percentDone.toFixed(1)}%</p>
        <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((tier) => {
            const total = backfill.rows.filter((row) => row.tier === tier).reduce((sum, row) => sum + row.count, 0);
            const done = backfill.rows.filter((row) => row.tier === tier && (row.status === "done" || row.status === "skipped")).reduce((sum, row) => sum + row.count, 0);
            return <div key={tier} className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs"><b className="text-white/80">Tier {tier}</b><p className="mt-1 text-white/45">{done}/{total} complete</p></div>;
          })}
        </div>
        {backfill.lastRun && <p className="mt-3 text-xs text-white/38">Last run {stamp(backfill.lastRun.createdAt)} · {backfill.lastRun.status} · {duration(backfill.lastRun.durationMs)}</p>}
        {message && <p className="mt-3 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-3 py-2 text-sm text-cyan-100/85">{message}</p>}
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.03]">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black">Coverage Gaps</h2>
            <p className="mt-1 text-sm text-white/42">
              {data.severityCounts.critical} critical · {data.severityCounts.high} high · {data.severityCounts.medium} medium · {data.severityCounts.low} low
            </p>
            {quoteNoHistoryCount > 0 && <p className="mt-1 text-xs text-amber-200/75">Quote but no OHLCV history: {quoteNoHistoryCount.toLocaleString("en-IN")}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={market} onChange={(e) => setMarket(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"><option value="ALL">All markets</option><option value="IN">India</option><option value="US">US</option></select>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"><option value="all">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"><option value="all">All issue types</option>{issueTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
          </div>
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-white/35">
              <tr><th className="px-4 py-3">Symbol</th><th>Market</th><th>Issue</th><th>Detail</th><th>Severity</th><th>Action</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {gaps.slice(0, 250).map((gap, idx) => (
                <tr key={`${gap.symbol}:${gap.issueType}:${idx}`}>
                  <td className="px-4 py-3 font-semibold">{gap.symbol}</td>
                  <td className="text-white/55">{gap.market}</td>
                  <td>{gap.issueType}</td>
                  <td className="max-w-[520px] text-white/48">{gap.detail}</td>
                  <td><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${SEVERITY[gap.severity]}`}>{gap.severity}</span></td>
                  <td className="max-w-[260px] text-xs text-cyan-200/80"><ActionCell gap={gap} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 p-4 lg:hidden">
          {gaps.slice(0, 100).map((gap, idx) => (
            <div key={`${gap.symbol}:${idx}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3"><b>{gap.symbol}</b><span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${SEVERITY[gap.severity]}`}>{gap.severity}</span></div>
              <p className="mt-1 text-sm text-white/70">{gap.issueType}</p>
              <p className="mt-1 text-xs text-white/42">{gap.detail}</p>
              <p className="mt-2 text-xs text-cyan-200/80"><ActionCell gap={gap} /></p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.03]">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-lg font-black">Sync Log Viewer</h2><p className="mt-1 text-sm text-white/42">Last 50 cron runs from local Postgres.</p></div>
          <div className="flex gap-2">
            <select value={job} onChange={(e) => setJob(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"><option value="all">All jobs</option>{jobs.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"><option value="all">All statuses</option><option value="ok">ok</option><option value="error">error</option></select>
          </div>
        </div>
        <div className="divide-y divide-white/5">
          {runs.map((run) => (
            <details key={run.id} className="group px-4 py-3 text-sm">
              <summary className="grid cursor-pointer gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                <b>{run.job}</b>
                <span className="font-mono text-white/50">{stamp(run.createdAt)}</span>
                <span className="font-mono text-white/50">{duration(run.durationMs)}</span>
                <span className={run.status === "ok" ? "text-emerald-300" : "text-rose-300"}>{run.status}</span>
              </summary>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/35 p-3 text-xs text-white/55">{JSON.stringify({ error: run.error, detail: run.detail }, null, 2)}</pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
