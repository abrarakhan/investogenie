import type { ConsolidatedHolding } from "@/lib/portfolioHoldings";

const inr = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const compact = (value: number) => {
  const abs = Math.abs(value);
  const text = abs >= 1e7 ? `${(abs / 1e7).toFixed(2)}Cr` : abs >= 1e5 ? `${(abs / 1e5).toFixed(2)}L` : abs >= 1e3 ? `${(abs / 1e3).toFixed(2)}K` : abs.toFixed(1);
  return `₹${value < 0 ? "-" : ""}${text}`;
};
const day = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(value))
  : "—";

function Move({ amount, pct, size = "sm" }: { amount: number; pct: number; size?: "sm" | "lg" }) {
  const up = amount >= 0;
  return (
    <span className={`${up ? "text-emerald-400" : "text-rose-400"} ${size === "lg" ? "text-lg font-bold" : "text-sm font-semibold"} tabular-nums`}>
      {up ? "+" : "-"}{inr(Math.abs(amount))} <span className="text-xs">({up ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%)</span>
    </span>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Fund cards: name, one-day change, invested value, current value and total gain. Anything the
 * data cannot support yet (no cost on the CAS, no consecutive NAVs) shows as unavailable rather
 * than as a fabricated figure.
 */
export default function FundHoldingCards({ funds }: { funds: ConsolidatedHolding[] }) {
  const valued = funds.filter((fund) => fund.value !== null);
  const current = valued.reduce((sum, fund) => sum + (fund.value ?? 0), 0);
  const withCost = valued.filter((fund) => fund.invested !== null);
  const invested = withCost.reduce((sum, fund) => sum + (fund.invested ?? 0), 0);
  const costedCurrent = withCost.reduce((sum, fund) => sum + (fund.value ?? 0), 0);
  const withDay = valued.filter((fund) => fund.dayChange !== null);
  const dayChange = withDay.reduce((sum, fund) => sum + (fund.dayChange ?? 0), 0);
  const dayBase = withDay.reduce((sum, fund) => sum + (fund.value ?? 0) - (fund.dayChange ?? 0), 0);
  const allCosted = withCost.length === valued.length && valued.length > 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:grid-cols-4">
        <Metric label="Current value"><span className="text-2xl font-bold tabular-nums">{inr(current)}</span></Metric>
        <Metric label="Invested value">
          {withCost.length ? (
            <span className="text-2xl font-bold tabular-nums">{inr(invested)}</span>
          ) : <span className="text-sm text-white/45">Not on your CAS import</span>}
          {withCost.length > 0 && !allCosted && <div className="text-[11px] text-white/40">{withCost.length} of {valued.length} funds</div>}
        </Metric>
        <Metric label="Total gain">
          {withCost.length ? <Move amount={costedCurrent - invested} pct={invested > 0 ? ((costedCurrent / invested) - 1) * 100 : 0} size="lg" />
            : <span className="text-sm text-white/45">Needs invested value</span>}
        </Metric>
        <Metric label="1D change">
          {withDay.length ? <Move amount={dayChange} pct={dayBase > 0 ? (dayChange / dayBase) * 100 : 0} size="lg" />
            : <span className="text-sm text-white/45">After two daily NAV updates</span>}
        </Metric>
      </div>

      {funds.length === 0 ? (
        <p className="text-sm text-white/50">No mutual fund holdings imported yet.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {funds.map((fund) => {
            const gain = fund.value !== null && fund.invested !== null ? fund.value - fund.invested : null;
            return (
              <article key={fund.key} className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <h3 className="text-base font-bold leading-snug">{fund.name ?? fund.ticker}</h3>
                <div className="mt-1 text-sm text-white/50">
                  1D Change:{" "}
                  {fund.dayChange !== null && fund.dayChangePct !== null ? (
                    <span className={fund.dayChange >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {compact(fund.dayChange)} {fund.dayChange >= 0 ? "▲" : "▼"} {Math.abs(fund.dayChangePct).toFixed(2)}%
                    </span>
                  ) : <span className="text-white/35">unavailable</span>}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Metric label="Invested">
                    <span className="font-semibold tabular-nums">{fund.invested === null ? "—" : inr(fund.invested)}</span>
                  </Metric>
                  <Metric label="Current">
                    <span className="font-semibold tabular-nums">{fund.value === null ? "—" : inr(fund.value)}</span>
                  </Metric>
                  <Metric label="Total">
                    {gain !== null && fund.invested ? <Move amount={gain} pct={(gain / fund.invested) * 100} />
                      : <span className="text-sm text-white/35">—</span>}
                  </Metric>
                </div>
                {(fund.stale || fund.priceSource === "STATEMENT") && (
                  <p className="mt-3 text-[11px] text-amber-200/80">
                    Valued at {fund.priceSource === "STATEMENT" ? "the CAS statement value" : "an NAV"} from {day(fund.asOf)}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
