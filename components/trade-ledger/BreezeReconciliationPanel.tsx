import Link from "next/link";
import type { BreezeReconciliation } from "@/lib/breeze/broker";
import BrokerOrderActions from "@/components/trade-ledger/BrokerOrderActions";

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
        <p className="mt-1 text-xs text-white/45">Read-only broker check for InvestoGenie trades since {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(`${data.scopeStart}T00:00:00+05:30`))}. Older long-term holdings are excluded.</p>
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
    {data.openOrders.length > 0 && <div className="mt-4">
      <h3 className="text-sm font-semibold text-white/80">Open orders at ICICI</h3>
      <p className="mt-1 text-[11px] text-white/35">As of the last check, which runs every five minutes in market hours. Cancelling or changing an order here sends the request to ICICI under your own session, after you confirm it. InvestoGenie never places an order from this panel.</p>
      <div className="mt-2 space-y-2">
        {data.openOrders.map((order) => <div key={order.orderId} className="rounded-lg border border-white/8 bg-black/20 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <strong className="text-sm">{order.name}</strong>
            <span>{order.action ?? "Order"}{order.orderType ? ` · ${order.orderType}` : ""}</span>
            {order.quantity !== null && <span>{order.pendingQuantity !== null && order.pendingQuantity !== order.quantity ? `${order.pendingQuantity.toLocaleString("en-IN")} of ` : ""}{order.quantity.toLocaleString("en-IN")} shares open</span>}
            {order.price !== null && <span>at ₹{order.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
            <span className="text-white/45">{order.status}</span>
          </div>
          <BrokerOrderActions orderId={order.orderId} name={order.name} side={order.action} quantity={order.quantity} price={order.price} canModify={(order.orderType ?? "").toLowerCase() === "limit"} />
        </div>)}
      </div>
    </div>}
    {data.liveOrderUpdates.length > 0 && <div className="mt-4">
      <h3 className="text-sm font-semibold text-white/80">Live order updates</h3>
      <p className="mt-1 text-[11px] text-white/35">Pushed by the broker as they happen. The reconciliation above remains the record of the account.</p>
      <div className="mt-2 divide-y divide-white/8 rounded-lg border border-white/8">
        {data.liveOrderUpdates.map((update) => <div key={update.id} className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 text-xs sm:grid-cols-[1.4fr_1fr_auto]">
          <span><strong>{update.name}</strong>{update.action ? ` · ${update.action}` : ""}{update.quantity !== null ? ` · ${update.executedQuantity !== null && update.executedQuantity !== update.quantity ? `${update.executedQuantity.toLocaleString("en-IN")} of ` : ""}${update.quantity.toLocaleString("en-IN")}` : ""}</span>
          <span className={/reject/i.test(update.status) ? "text-rose-300" : /execut/i.test(update.status) ? "text-emerald-300" : "text-white/60"}>{update.status}</span>
          <span className="hidden text-white/35 sm:block">{new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date(update.receivedAt))} IST</span>
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
