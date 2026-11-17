"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { shouldRefreshLiveQuotes } from "@/lib/liveQuoteRefresh";

export default function MarketDataAutoRefresh({ market, assetIds = [] }: { market: "IN" | "US"; assetIds?: string[] }) {
  const router = useRouter();
  const [warning, setWarning] = useState<string | null>(null);
  const ids = JSON.stringify([...new Set(assetIds)].sort());

  useEffect(() => {
    if (market !== "IN" || ids === "[]") return;
    let cancelled = false;
    const allIds = JSON.parse(ids) as string[];
    // Every in-flight request this effect starts, so unmount and a re-render can cancel them.
    const inFlight = new Set<AbortController>();
    const refreshQuotes = async () => {
      if (document.visibilityState !== "visible") return;
      // Breeze live quotes are an intraday facility. Outside the exchange
      // session, retain the final known quote without reporting an expected
      // off-hours skip as a refresh failure.
      if (!shouldRefreshLiveQuotes("IN")) {
        setWarning(null);
        return;
      }
      const batches = Array.from({ length: Math.ceil(allIds.length / 50) }, (_, index) => allIds.slice(index * 50, (index + 1) * 50));
      const controller = new AbortController();
      inFlight.add(controller);
      // The route gives the worker 55s. Past that the answer is not coming, and a request
      // left hanging is one more thing the next tick has to race.
      const expiry = window.setTimeout(() => controller.abort(), 60_000);
      try {
        const results = await Promise.all(batches.map(async (batch) => {
          const response = await fetch("/api/breeze/refresh-quotes", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetIds: batch }),
            signal: controller.signal,
          });
          return { response, result: await response.json() };
        }));
        if (cancelled) return;
        const incomplete = results.some(({ response, result }) => !response.ok
          || (result.reason !== "off_hours" && (result.errors?.length || result.unmapped)));
        const budgetSpent = results.some(({ result }) => result.budget === "spent");
        setWarning(incomplete ? "Some Breeze quotes could not be refreshed. Last known prices remain visible."
          : budgetSpent ? "Today's Breeze quote allowance is used up. Stocks on the live feed keep updating; others show their last price."
            : null);
        // A REST refresh can touch freshness without changing anything shown.
        // Recompute the analytics pages for a material quote/depth change, or
        // when the live feed is already carrying these stocks' prices.
        if (results.some(({ result }) => result.changed > 0 || result.live > 0)) router.refresh();
      } catch (error) {
        // A cancelled request says nothing about Breeze. This banner reported one as an
        // outage for months: the route answers a genuine Breeze failure with a 502 and a
        // JSON body, which the `incomplete` check above already covers, so the only way
        // here was a rejected fetch -- and in production nginx logged 21 of these as 499
        // (client closed the connection) against zero 5xx. Navigating away, hiding the tab
        // or a re-render was being shown to the user as "Breeze refresh unavailable".
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setWarning("Breeze refresh unavailable; last known prices remain visible.");
      } finally {
        window.clearTimeout(expiry);
        inFlight.delete(controller);
      }
    };
    void refreshQuotes();
    const timer = window.setInterval(refreshQuotes, 120_000);
    document.addEventListener("visibilitychange", refreshQuotes);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshQuotes);
      for (const controller of inFlight) controller.abort();
    };
  }, [market, ids, router]);

  return warning ? <p role="status" className="mb-3 text-xs text-amber-200">{warning}</p> : null;
}
