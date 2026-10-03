import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getAdaptiveBacktest, getSavedAdaptiveStrategies } from "@/lib/adaptiveAllocation";
import { normalizeMarket } from "@/lib/markets";
import { deleteAdaptiveStrategy, saveAdaptiveStrategy } from "./actions";

export const dynamic = "force-dynamic";

const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const money = (value: number, market: "IN" | "US") => new Intl.NumberFormat(market === "IN" ? "en-IN" : "en-US", {
  style: "currency", currency: market === "IN" ? "INR" : "USD", maximumFractionDigits: 0,
}).format(value);

function MetricCard({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-white/10 bg-black/20 p-4"><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/38">{label}</div><div className={`mt-2 text-xl font-black ${tone}`}>{value}</div></div>;
}

export default async function AdaptiveAllocationPage({
  params, searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const market = normalizeMarket((await params).market);
  if (!market) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const defaults = market === "IN" ? ["RELIANCE", "TCS"] : ["AAPL", "MSFT"];
  const tickerA = String(query.a ?? defaults[0]).toUpperCase();
  const tickerB = String(query.b ?? defaults[1]).toUpperCase();
  const lookbackYears = Math.max(1, Math.min(20, Number(query.years ?? 5) || 5));
  const initialCapital = Math.max(1, Number(query.capital ?? (market === "IN" ? 100000 : 10000)) || 100000);
  const feeBps = Math.max(0, Number(query.feeBps ?? 15) || 0);
  const noTradeBandPct = Math.max(0, Number(query.band ?? 1) || 0);
  const [saved, outcome] = await Promise.all([
    getSavedAdaptiveStrategies(user.id, market),
    getAdaptiveBacktest({ market, tickerA, tickerB, lookbackYears, initialCapital, feeBps, noTradeBandPct })
      .then((value) => ({ value, error: null })).catch((error: unknown) => ({ value: null, error: error instanceof Error ? error.message : "Backtest failed." })),
  ]);
  const result = outcome.value?.result;
  const comparisons = result ? [
    ["Universal portfolio, net", result.universalNet],
    ["Universal portfolio, gross", result.universalGross],
    ["Equal-weight daily CRP, net", result.equalCrpNet],
    ["Equal-weight buy and hold", result.buyHold],
    [`Hindsight-best CRP (${(result.hindsightBestCrp.weightA * 100).toFixed(0)}/${((1-result.hindsightBestCrp.weightA)*100).toFixed(0)})`, result.hindsightBestCrp],
  ] as const : [];

  return <AppShell email={user.email} market={market} active="adaptive-allocation" title="Adaptive Allocation Lab" subtitle="Cost-aware Universal Portfolio research and paper tracking. It does not alter stock signals, rankings, ledger plans, or broker orders.">
    <div className="space-y-8">
      <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
        <form className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
          <label className="text-xs text-white/55">Asset A<input name="a" defaultValue={tickerA} required className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" /></label>
          <label className="text-xs text-white/55">Asset B<input name="b" defaultValue={tickerB} required className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" /></label>
          <label className="text-xs text-white/55">Lookback<select name="years" defaultValue={lookbackYears} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0b0e15] px-3 py-2.5 text-sm"><option value="1">1 year</option><option value="3">3 years</option><option value="5">5 years</option><option value="10">10 years</option><option value="20">20 years</option></select></label>
          <label className="text-xs text-white/55">Starting capital<input name="capital" type="number" min="1" defaultValue={initialCapital} className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm" /></label>
          <label className="text-xs text-white/55">Costs (bps)<input name="feeBps" type="number" min="0" step="0.1" defaultValue={feeBps} className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm" /></label>
          <label className="text-xs text-white/55">No-trade band %<input name="band" type="number" min="0" step="0.1" defaultValue={noTradeBandPct} className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm" /></label>
          <button className="self-end rounded-lg bg-[var(--ig-accent)] px-4 py-2.5 text-sm font-bold text-black">Run backtest</button>
        </form>
      </section>

      {outcome.error && <div className="rounded-lg border border-rose-400/25 bg-rose-400/8 p-5 text-sm text-rose-200"><div className="font-bold">Backtest blocked</div><p className="mt-1 text-rose-100/75">{outcome.error}</p></div>}

      {result && outcome.value && <>
        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">{outcome.value.assetA.ticker} / {outcome.value.assetB.ticker} · {result.sessions} common sessions</div><h2 className="mt-1 text-2xl font-black">Backtest verdict</h2><p className="mt-1 text-sm text-white/45">{result.startDate} to {result.endDate}; adjusted history current through the expected session.</p></div>
            <span className={`rounded-full border px-4 py-2 text-sm font-black ${result.verdict === "SUCCESS" ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-300" : result.verdict === "MIXED" ? "border-amber-400/35 bg-amber-400/10 text-amber-200" : "border-rose-400/35 bg-rose-400/10 text-rose-300"}`}>{result.verdict}</span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard label="Net final value" value={money(result.universalNet.finalValue, market)} />
            <MetricCard label="Net CAGR" value={pct(result.universalNet.cagrPct)} tone={result.universalNet.cagrPct >= 0 ? "text-emerald-300" : "text-rose-300"} />
            <MetricCard label="Max drawdown" value={pct(result.universalNet.maxDrawdownPct)} tone="text-rose-300" />
            <MetricCard label="Est. costs" value={money(result.estimatedCosts, market)} />
            <MetricCard label="Total turnover" value={`${result.totalTurnover.toFixed(2)}x`} />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-5"><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--ig-accent)]">Next-session paper target</div><div className="mt-4 flex justify-between text-lg font-black"><span>{outcome.value.assetA.ticker} {(result.latestTarget[0]*100).toFixed(1)}%</span><span>{outcome.value.assetB.ticker} {(result.latestTarget[1]*100).toFixed(1)}%</span></div><div className="mt-3 flex h-3 overflow-hidden rounded-full bg-white/10"><div className="bg-[var(--ig-accent)]" style={{ width: `${result.latestTarget[0]*100}%` }} /><div className="bg-cyan-300" style={{ width: `${result.latestTarget[1]*100}%` }} /></div><p className="mt-4 text-xs leading-relaxed text-white/42">Research target only. Apply it after costs, taxes, lot size and liquidity checks; no order is sent to ICICI Direct.</p></div>
          <form action={saveAdaptiveStrategy} className="rounded-lg border border-white/10 bg-white/[0.025] p-5"><div className="font-bold">Save as paper strategy</div><p className="mt-1 text-xs text-white/42">Stores this configuration and today&apos;s result for later comparison.</p><input type="hidden" name="market" value={market} /><input type="hidden" name="tickerA" value={tickerA} /><input type="hidden" name="tickerB" value={tickerB} /><input type="hidden" name="initialCapital" value={initialCapital} /><input type="hidden" name="feeBps" value={feeBps} /><input type="hidden" name="noTradeBandPct" value={noTradeBandPct} /><input type="hidden" name="lookbackYears" value={lookbackYears} /><div className="mt-4 flex gap-3"><input name="name" defaultValue={`${tickerA} / ${tickerB}`} maxLength={80} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm" /><button className="rounded-lg border border-[var(--ig-accent)]/35 px-4 py-2 text-sm font-bold text-[var(--ig-accent)]">Save</button></div></form>
        </section>

        <section className="overflow-hidden rounded-lg border border-white/10"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-bold">Strategy comparison</h2><p className="mt-1 text-xs text-white/40">Success means net Universal wealth beats both equal-weight daily rebalancing and equal-weight buy-and-hold. Hindsight-best is an unreachable ceiling, not a recommendation.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.15em] text-white/38"><tr><th className="px-5 py-3">Method</th><th className="px-4 py-3">Final</th><th className="px-4 py-3">Return</th><th className="px-4 py-3">CAGR</th><th className="px-4 py-3">Volatility</th><th className="px-4 py-3">Max DD</th></tr></thead><tbody>{comparisons.map(([label, metric]) => <tr key={label} className="border-t border-white/8"><td className="px-5 py-3 font-semibold">{label}</td><td className="px-4 py-3">{money(metric.finalValue, market)}</td><td className="px-4 py-3">{pct(metric.totalReturnPct)}</td><td className="px-4 py-3">{pct(metric.cagrPct)}</td><td className="px-4 py-3">{metric.annualVolatilityPct.toFixed(2)}%</td><td className="px-4 py-3 text-rose-300">{metric.maxDrawdownPct.toFixed(2)}%</td></tr>)}</tbody></table></div></section>
      </>}

      <section><h2 className="text-xl font-black">Saved paper strategies</h2>{saved.length === 0 ? <p className="mt-3 text-sm text-white/42">No saved strategies yet.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2">{saved.map((item) => <div key={item.id} className="rounded-lg border border-white/10 bg-white/[0.025] p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-bold">{item.name}</div><div className="mt-1 text-xs text-white/42">{item.tickerA} / {item.tickerB} · {item.lookbackYears}y · {item.feeBps} bps</div></div><span className="text-xs font-bold text-white/55">{item.latestVerdict ?? "PENDING"}</span></div>{item.latestWeightA !== null && <div className="mt-3 text-sm">Latest target: <b>{item.tickerA} {(item.latestWeightA*100).toFixed(1)}%</b> / {item.tickerB} {((1-item.latestWeightA)*100).toFixed(1)}%</div>}<div className="mt-4 flex gap-2"><a href={`?a=${item.tickerA}&b=${item.tickerB}&years=${item.lookbackYears}&capital=${item.initialCapital}&feeBps=${item.feeBps}&band=${item.noTradeBandPct}`} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold">Open</a><form action={deleteAdaptiveStrategy}><input type="hidden" name="market" value={market} /><input type="hidden" name="strategyId" value={item.id} /><button className="rounded-lg px-3 py-2 text-xs font-bold text-rose-300">Delete</button></form></div></div>)}</div>}</section>
    </div>
  </AppShell>;
}
