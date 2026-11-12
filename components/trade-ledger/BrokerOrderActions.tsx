"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "idle" | "confirm-cancel" | "edit" | "confirm-modify";

/**
 * Cancel or change one open broker order. Every action needs a second, explicit
 * confirmation that restates what will be sent to ICICI.
 */
export default function BrokerOrderActions({ orderId, name, side, quantity, price, canModify }: {
  orderId: string; name: string; side: string | null; quantity: number | null; price: number | null; canModify: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [newPrice, setNewPrice] = useState(price === null ? "" : String(price));
  const [newQuantity, setNewQuantity] = useState(quantity === null ? "" : String(quantity));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/breeze/order-action", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, confirmed: true, ...payload }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The request did not complete.");
      setMessage({ ok: true, text: done });
      setMode("idle");
      router.refresh();
    } catch (reason) {
      setMessage({ ok: false, text: reason instanceof Error ? reason.message : "The request did not complete." });
      setMode("idle");
    } finally {
      setBusy(false);
    }
  };

  const button = "inline-flex min-h-9 items-center rounded-lg border px-3 font-semibold disabled:opacity-50";
  const label = `${side ?? "order"} ${name}`.trim();
  return (
    <div className="mt-2 space-y-2 text-xs">
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {canModify && <button type="button" onClick={() => { setMessage(null); setMode("edit"); }} className={`${button} border-white/15 text-white/75 hover:bg-white/10`}>Change price or quantity</button>}
          <button type="button" onClick={() => { setMessage(null); setMode("confirm-cancel"); }} className={`${button} border-rose-400/30 text-rose-200 hover:bg-rose-400/10`}>Cancel order</button>
        </div>
      )}
      {mode === "confirm-cancel" && (
        <div className="rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-3">
          <p className="text-rose-100">Cancel the open {label} order at ICICI? This is sent to the broker immediately.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => send({ action: "cancel" }, "Cancel request accepted by ICICI.")} className={`${button} border-rose-400/40 bg-rose-400/15 text-rose-100`}>{busy ? "Sending…" : "Yes, cancel it"}</button>
            <button type="button" disabled={busy} onClick={() => setMode("idle")} className={`${button} border-white/15 text-white/65`}>Keep the order</button>
          </div>
        </div>
      )}
      {(mode === "edit" || mode === "confirm-modify") && (
        <div className="rounded-lg border border-white/12 bg-black/25 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block"><span className="mb-1 block text-white/45">Limit price (₹)</span>
              <input type="number" inputMode="decimal" step="0.05" min="0.05" value={newPrice} disabled={mode === "confirm-modify"} onChange={(event) => setNewPrice(event.target.value)} className="field w-32" /></label>
            <label className="block"><span className="mb-1 block text-white/45">Quantity</span>
              <input type="number" inputMode="numeric" step="1" min="1" value={newQuantity} disabled={mode === "confirm-modify"} onChange={(event) => setNewQuantity(event.target.value)} className="field w-28" /></label>
            {mode === "edit" && <>
              <button type="button" onClick={() => setMode("confirm-modify")} disabled={!(Number(newPrice) > 0) || !Number.isInteger(Number(newQuantity)) || Number(newQuantity) < 1} className={`${button} border-white/15 text-white/80 hover:bg-white/10`}>Review change</button>
              <button type="button" onClick={() => setMode("idle")} className={`${button} border-white/10 text-white/50`}>Back</button>
            </>}
          </div>
          {mode === "confirm-modify" && (
            <div className="mt-3">
              <p className="text-amber-100">Change the open {label} order to {Number(newQuantity).toLocaleString("en-IN")} shares at ₹{Number(newPrice).toFixed(2)}? This is sent to the broker immediately.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => send({ action: "modify", price: Number(newPrice), quantity: Number(newQuantity) }, "Change accepted by ICICI.")} className={`${button} border-amber-400/40 bg-amber-400/15 text-amber-100`}>{busy ? "Sending…" : "Yes, change it"}</button>
                <button type="button" disabled={busy} onClick={() => setMode("edit")} className={`${button} border-white/15 text-white/65`}>Go back</button>
              </div>
            </div>
          )}
        </div>
      )}
      {message && <p className={message.ok ? "text-emerald-300" : "text-amber-100/85"}>{message.text}</p>}
    </div>
  );
}
