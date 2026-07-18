import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AppShell from "@/components/app/AppShell";
import { getSyncStatus } from "@/lib/syncStatus";

export const dynamic = "force-dynamic";

type Tone = "ok" | "error" | "neutral";

function stamp(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function duration(value: number | null): string {
  if (value === null) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function badgeTone(status: string | null): Tone {
  if (!status) return "neutral";
  return status === "ok" ? "ok" : "error";
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  const cls = tone === "ok"
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
    : tone === "error"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
      : "border-white/10 bg-white/5 text-white/45";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>{children}</span>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/10 px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-white/60">{title}</div>
      {children}
    </section>
  );
}

export default async function SyncAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const data = await getSyncStatus();

  return (
    <AppShell
      email={user.email ?? ""}
      market="US"
      active="data"
      title="Data Health"
      subtitle="Market-data freshness, provider coverage, and recent job history."
      actions={<div className="text-xs text-white/35">Generated {stamp(data.generatedAt)}</div>}
    >
      <div className="space-y-6">

        <div className="grid gap-4 lg:grid-cols-2">
          {data.markets.map((market) => (
            <Card key={market.country} title={`${market.country} market freshness`}>
              <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10 text-center">
                <div className="p-4"><b className="block text-2xl tabular-nums">{market.quotes.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">Quotes</span></div>
                <div className="p-4"><b className="block text-2xl tabular-nums">{market.history.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">History</span></div>
                <div className="p-4"><b className="block text-2xl tabular-nums">{market.fundamentals.toLocaleString()}</b><span className="text-[10px] uppercase text-white/35">Fund.</span></div>
              </div>
              <div className="grid gap-3 p-4 text-sm sm:grid-cols-2">
                <div><span className="text-white/35">Assets</span><div className="font-mono">{market.assets.toLocaleString()}</div></div>
                <div><span className="text-white/35">Quote date</span><div className="font-mono">{market.latestQuoteDate ?? "-"}</div></div>
                <div><span className="text-white/35">Quote DB update</span><div className="font-mono">{stamp(market.latestQuoteUpdatedAt)}</div></div>
                <div><span className="text-white/35">OHLCV date</span><div className="font-mono">{market.latestHistoryDate ?? "-"}</div></div>
                <div><span className="text-white/35">Financial period</span><div className="font-mono">{market.latestFundamentalsPeriod ?? "-"}</div></div>
              </div>
            </Card>
          ))}
        </div>

        <Card title="Cron jobs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-white/35">
                <tr><th className="px-4 py-3">Job</th><th>Last</th><th>Status</th><th>Runs</th><th>Avg</th><th>Error</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.cron.map((row) => (
                  <tr key={row.job}>
                    <td className="px-4 py-3 font-semibold">{row.job}</td>
                    <td className="font-mono text-white/60">{stamp(row.lastRunAt)}</td>
                    <td><Badge tone={badgeTone(row.lastStatus)}>{row.lastStatus ?? "none"}</Badge></td>
                    <td className="tabular-nums text-white/70">{row.okRuns} ok / {row.errorRuns} err</td>
                    <td className="tabular-nums text-white/60">{duration(row.avgDurationMs)}</td>
                    <td className="max-w-[340px] truncate text-white/35">{row.lastError ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Quote provider state">
            <div className="divide-y divide-white/5">
              {data.quoteProviders.map((row) => (
                <div key={row.provider} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto]">
                  <div>
                    <b>{row.provider}</b>
                    <div className="mt-1 text-xs text-white/40">Last success {stamp(row.lastSuccessAt)} · Last attempt {stamp(row.lastAttemptAt)}</div>
                    {row.sampleError && <div className="mt-1 truncate text-xs text-amber-300/70">{row.sampleError}</div>}
                  </div>
                  <div className="text-right tabular-nums text-white/65">{row.succeeded.toLocaleString()} / {row.attempted.toLocaleString()} ok</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Fundamentals provider state">
            <div className="divide-y divide-white/5">
              {data.fundamentalsProviders.map((row) => (
                <div key={`${row.country}:${row.provider}`} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto]">
                  <div>
                    <b>{row.country} · {row.provider}</b>
                    <div className="mt-1 text-xs text-white/40">Last success {stamp(row.lastSuccessAt)} · Last attempt {stamp(row.lastAttemptAt)}</div>
                    {row.sampleError && <div className="mt-1 truncate text-xs text-amber-300/70">{row.sampleError}</div>}
                  </div>
                  <div className="text-right tabular-nums text-white/65">{row.succeeded.toLocaleString()} / {row.attempted.toLocaleString()} ok</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card title="Recent runs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-white/35">
                <tr><th className="px-4 py-3">Time</th><th>Job</th><th>Status</th><th>Duration</th><th>Detail</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3 font-mono text-white/60">{stamp(run.createdAt)}</td>
                    <td className="font-semibold">{run.job}</td>
                    <td><Badge tone={badgeTone(run.status)}>{run.status}</Badge></td>
                    <td className="tabular-nums text-white/60">{duration(run.durationMs)}</td>
                    <td className="max-w-[520px] truncate text-white/35">{run.error ?? JSON.stringify(run.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
