"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function MarketDataAutoRefresh({ market, assetIds = [] }: { market: "IN" | "US"; assetIds?: string[] }) {
  const router = useRouter();
  const [warning, setWarning] = useState<string | null>(null);
  const ids = JSON.stringify([...new Set(assetIds)].sort());

  useEffect(() => {
    if (market !== "IN" || ids === "[]") return;
    let cancelled = false;
    const allIds = JSON.parse(ids) as string[];
    const refreshQuotes = async () => {
      if (document.visibilityState !== "visible") return;
      const batches = Array.from({ length: Math.ceil(allIds.length / 50) }, (_, index) => allIds.slice(index * 50, (index + 1) * 50));
      try {
        const results = await Promise.all(batches.map(async (batch) => {
          const response = await fetch("/api/breeze/refresh-quotes", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetIds: batch }),
          });
          return { response, result: await response.json() };
        }));
        if (cancelled) return;
        const incomplete = results.some(({ response, result }) => !response.ok || result.errors?.length || result.unmapped);
        setWarning(incomplete ? "Some Breeze quotes could not be refreshed. Last known prices remain visible." : null);
        // A REST refresh can touch freshness without changing anything shown.
        // Recompute the analytics pages only for a material quote/depth change.
        if (results.some(({ result }) => result.changed > 0)) router.refresh();
      } catch {
        if (!cancelled) setWarning("Breeze refresh unavailable; last known prices remain visible.");
      }
    };
    void refreshQuotes();
    const timer = window.setInterval(refreshQuotes, 120_000);
    document.addEventListener("visibilitychange", refreshQuotes);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshQuotes);
    };
  }, [market, ids, router]);

  return warning ? <p role="status" className="mb-3 text-xs text-amber-200">{warning}</p> : null;
}
