"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function MarketDataAutoRefresh({ market, assetIds = [] }: { market: "IN" | "US"; assetIds?: string[] }) {
  const router = useRouter();
  const [warning, setWarning] = useState<string | null>(null);
  const ids = JSON.stringify(assetIds.slice(0, 50));

  useEffect(() => {
    if (market !== "IN" || ids === "[]") return;
    let cancelled = false;
    fetch("/api/breeze/refresh-quotes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: JSON.parse(ids) }),
    }).then(async (response) => {
      const result = await response.json();
      if (cancelled) return;
      if (!response.ok || result.errors?.length || result.unmapped) {
        setWarning(result.error ?? "Some Breeze quotes could not be refreshed. Last known prices remain visible.");
      }
      if (result.updated > 0) router.refresh();
    }).catch(() => {
      if (!cancelled) setWarning("Breeze refresh unavailable; last known prices remain visible.");
    });
    return () => { cancelled = true; };
  }, [market, ids, router]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [market, router]);

  return warning ? <p role="status" className="mb-3 text-xs text-amber-200">{warning}</p> : null;
}
