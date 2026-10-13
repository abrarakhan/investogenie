import { cancelPendingBuyStop, fillPendingBuyStop } from "@/app/terminal/[market]/trade-ledger/pendingOrderActions";
import { zonedMarketClock } from "@/lib/market-calendar.mjs";
import type { PendingOrder } from "@/lib/swingPendingOrders";

const fmt = (value: number | null) => value === null ? "-" : value.toFixed(2);

/**
 * Unfilled buy-stops. They carry no position, capital or P&L; a confirmed fill inside
 * [trigger, limit] is the only way one becomes a purchased trade.
 */
export default function PendingOrders({ market, orders }: { market: "IN" | "US"; orders: PendingOrder[] }) {
  if (!orders.length) return null;
  const today = zonedMarketClock(market).date;
  return (
    <section className="mb-6 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.03] p-4">
      <h2 className="font-bold">Pending buy-stop orders</h2>
      <p className="mt-1 text-xs text-white/45">Not purchases. Confirm each fill only after the broker shows it executed; fills must be between the trigger and the limit. A partial fill becomes a trade and the remainder stays pending until filled or cancelled.</p>
      <div className="mt-3 space-y-3">
        {orders.map((order) => (
          <div key={order.id} className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="text-sm font-bold">{order.ticker}</span>
              <span>
                {order.remainingQuantity.toLocaleString("en-IN")} of {order.quantity.toLocaleString("en-IN")} shares unfilled
                {order.filledQuantity > 0 ? ` · ${order.filledQuantity.toLocaleString("en-IN")} already filled` : ""}
              </span>
              <span>Trigger {fmt(order.trigger)} · Limit {fmt(order.limit)}</span>
              <span className="text-emerald-300">Target {fmt(order.target)}</span>
              <span className="text-rose-300">Stop {fmt(order.stop)}</span>
              <span className="text-white/45">Current {fmt(order.currentPrice)}</span>
              <span className={order.expired ? "font-semibold text-amber-200" : "text-white/45"}>
                {order.expired ? `Expired ${order.validUntil}` : `Valid until ${order.validUntil}`}
              </span>
              {order.triggerReached && !order.expired && <span className="font-semibold text-cyan-200">Trigger reached — check your broker for a fill</span>}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <form action={fillPendingBuyStop} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="market" value={market} />
                <input type="hidden" name="orderId" value={order.id} />
                <label className="grid gap-1 text-[10px] uppercase tracking-wide text-white/40">Fill date
                  <input name="filledOn" type="date" required min={order.placedOn} max={today < order.validUntil ? today : order.validUntil} defaultValue={today < order.validUntil ? today : order.validUntil} className="field h-10" />
                </label>
                <label className="grid gap-1 text-[10px] uppercase tracking-wide text-white/40">Fill price
                  <input name="fillPrice" type="number" required step="any" min={order.trigger} max={order.limit} className="field h-10 w-28" />
                </label>
                <label className="grid gap-1 text-[10px] uppercase tracking-wide text-white/40">Filled qty
                  <input name="fillQuantity" type="number" required step={market === "IN" ? 1 : "any"} min={market === "IN" ? 1 : 0.000001} max={order.remainingQuantity} defaultValue={order.remainingQuantity} className="field h-10 w-24" />
                </label>
                <button className="h-10 rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-3 font-semibold text-emerald-200 hover:bg-emerald-400/15">Confirm fill</button>
              </form>
              <form action={cancelPendingBuyStop}>
                <input type="hidden" name="market" value={market} />
                <input type="hidden" name="orderId" value={order.id} />
                <button className="h-10 rounded-lg border border-white/15 px-3 font-semibold text-white/60 hover:bg-white/5">
                  {order.filledQuantity > 0 ? "Cancel remainder" : "Cancel order"}
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
