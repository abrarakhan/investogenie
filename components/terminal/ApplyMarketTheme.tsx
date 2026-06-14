"use client";

import { useEffect } from "react";
import { useMarket } from "@/context/MarketProvider";
import type { MarketId } from "@/lib/types";

/** Forces the global theme/benchmarks to this terminal's market (route-driven,
 *  not a user toggle). */
export default function ApplyMarketTheme({ market }: { market: MarketId }) {
  const { setMarket } = useMarket();
  useEffect(() => {
    setMarket(market);
  }, [market, setMarket]);
  return null;
}
