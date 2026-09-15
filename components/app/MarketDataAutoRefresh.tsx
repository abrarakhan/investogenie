"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MarketDataAutoRefresh({ market }: { market: "IN" | "US" }) {
  const router = useRouter();

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

  return null;
}

