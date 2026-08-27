"use client";

import { useState } from "react";
import { deleteSwingTrade } from "@/app/terminal/[market]/trade-ledger/actions";

export default function DeleteTradeButton({
  tradeId,
  market,
  ticker,
}: {
  tradeId: string;
  market: "IN" | "US";
  ticker: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-10 touch-manipulation rounded-lg px-3 text-sm font-semibold text-rose-300/70 hover:bg-rose-500/10 hover:text-rose-300"
      >
        Delete entry
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.07] p-3">
      <p className="text-sm text-white/75">
        Permanently delete the {ticker} ledger entry? This cannot be undone.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-10 touch-manipulation rounded-lg border border-white/12 px-4 text-sm font-semibold text-white/65"
        >
          Cancel
        </button>
        <form action={deleteSwingTrade}>
          <input type="hidden" name="tradeId" value={tradeId} />
          <input type="hidden" name="market" value={market} />
          <button className="min-h-10 touch-manipulation rounded-lg bg-rose-500 px-4 text-sm font-bold text-white">
            Delete permanently
          </button>
        </form>
      </div>
    </div>
  );
}
