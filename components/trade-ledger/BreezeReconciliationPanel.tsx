import Link from "next/link";
import type { BreezeReconciliation } from "@/lib/breeze/broker";

export default function BreezeReconciliationPanel({ data }: { data: BreezeReconciliation }) {
  if (!data.configured) {
    return <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4 text-sm text-white/55">
      Connect ICICI Breeze in <Link href="/settings" className="font-semibold text-[var(--ig-accent)]">Settings</Link> to reconcile broker holdings and orders with this ledger.
    </section>;
  }
  const healthy = data.status === "SUCCESS";
  return <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-bold">ICICI Breeze reconciliation</h2>
        <p className="mt-1 text-xs text-white/45">Read-only broker check. InvestoGenie never changes orders or ledger entries automatically.</p>
      </div>
      <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${healthy ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
        {data.status ?? "Awaiting first sync"}
      </span>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs sm:max-w-md">
      <Count label="Holdings" value={data.holdingsCount} />
      <Count label="Positions" value={data.positionsCount} />
      <Count label="Orders" value={data.ordersCount} />
    </div>
    {data.capturedAt && <p className="mt-3 text-xs text-white/35">Last checked {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(data.capturedAt))} IST</p>}
    {data.error && <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-amber-100">Partial sync: {data.error}</p>}
    {data.mismatches.length > 0 && <div className="mt-4">
      <h3 className="text-sm font-semibold text-amber-200">Quantity differences</h3>
      <div className="mt-2 divide-y divide-white/8 rounded-lg border border-white/8">
        {data.mismatches.slice(0, 20).map((item) => <div key={`${item.exchange}-${item.ticker}`} className="grid grid-cols-3 gap-2 px-3 py-2 text-xs">
          <span className="font-bold">{item.ticker}</span><span>Broker {item.brokerQuantity.toLocaleString("en-IN")}</span><span>Ledger {item.ledgerQuantity.toLocaleString("en-IN")}</span>
        </div>)}
      </div>
    </div>}
    {data.rejectedOrders.length > 0 && <div className="mt-4">
      <h3 className="text-sm font-semibold text-rose-200">Recent rejected orders</h3>
      <div className="mt-2 space-y-2">{data.rejectedOrders.map((order) => <div key={`${order.orderId}-${order.capturedAt}`} className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-3 text-xs">
        <strong>{order.stockCode ?? "Order"}</strong> · {order.status}{order.reason ? ` · ${order.reason}` : ""}
      </div>)}</div>
    </div>}
  </section>;
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-black/25 px-2 py-3"><div className="text-lg font-bold">{value}</div><div className="text-white/40">{label}</div></div>;
}
