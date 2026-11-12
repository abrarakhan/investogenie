"use client";

import { useRef, useState } from "react";

interface Preview {
  orderValue: number;
  charges: Array<{ key: string; label: string; amount: number }>;
  totalCharges: number;
  chargesPct: number | null;
}

const rupees = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);

/**
 * Sits inside the buy form and asks the broker what the order being typed would
 * cost. It reads the form's own fields, places nothing and stores nothing.
 */
export default function OrderCostPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; error: string | null; preview: Preview | null; basis: string | null }>(
    { loading: false, error: null, preview: null, basis: null },
  );

  const estimate = async () => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const data = new FormData(form);
    const assetId = String(data.get("assetId") ?? "");
    const price = Number(data.get("buyPrice"));
    const quantity = Number(data.get("quantity"));
    if (!assetId || !(price > 0) || !Number.isInteger(quantity) || quantity <= 0) {
      setState({ loading: false, error: "Choose a stock, then enter the buy price and a whole-share quantity.", preview: null, basis: null });
      return;
    }
    setState({ loading: true, error: null, preview: null, basis: null });
    try {
      const response = await fetch("/api/breeze/order-preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId, price, quantity, action: "buy" }),
      });
      const payload = await response.json() as Partial<Preview> & { error?: string };
      if (!response.ok || payload.error || typeof payload.totalCharges !== "number") {
        throw new Error(payload.error ?? "Could not get an estimate.");
      }
      setState({
        loading: false, error: null, preview: payload as Preview,
        basis: `${quantity.toLocaleString("en-IN")} shares at ${rupees(price)}`,
      });
    } catch (reason) {
      setState({ loading: false, error: reason instanceof Error ? reason.message : "Could not get an estimate.", preview: null, basis: null });
    }
  };

  const { loading, error, preview, basis } = state;
  return (
    <div ref={ref} className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs sm:col-span-2 lg:col-span-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={estimate} disabled={loading}
          className="inline-flex min-h-10 items-center rounded-lg border border-white/15 px-3 font-semibold text-white/75 hover:bg-white/10 disabled:opacity-50">
          {loading ? "Asking ICICI…" : "Estimate broker charges"}
        </button>
        <span className="text-white/40">Asks ICICI Breeze what this buy would cost. It does not place an order.</span>
      </div>
      {error && <p className="mt-3 text-amber-100/80">{error}</p>}
      {preview && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Order value <b className="tabular-nums">{rupees(preview.orderValue)}</b></span>
            <span>Charges <b className="tabular-nums text-amber-200">{rupees(preview.totalCharges)}</b>
              {preview.chargesPct !== null && <span className="text-white/45"> ({preview.chargesPct.toFixed(2)}% of the order)</span>}</span>
            <span>Total outlay <b className="tabular-nums">{rupees(preview.orderValue + preview.totalCharges)}</b></span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/45">
            {preview.charges.map((line) => <span key={line.key}>{line.label} <span className="tabular-nums text-white/65">{rupees(line.amount)}</span></span>)}
          </div>
          <p className="text-[11px] text-white/35">For {basis}, buy side only. Selling later adds its own charges. The figure is ICICI&apos;s estimate, not a contract note.</p>
        </div>
      )}
    </div>
  );
}
