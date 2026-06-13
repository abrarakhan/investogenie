"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_MARKET, MARKETS } from "@/lib/markets";
import type { MarketConfig, MarketId } from "@/lib/types";

interface MarketContextValue {
  marketId: MarketId;
  market: MarketConfig;
  setMarket: (id: MarketId) => void;
  toggleMarket: () => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

/**
 * Holds the globally-broadcast active market and, as a side effect, pushes the
 * active theme into CSS custom properties on <html>. Every consumer (ticker
 * tape, benchmarks, hero canvas colours) re-renders from this single source of
 * truth without a route reload.
 */
export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [marketId, setMarketId] = useState<MarketId>(DEFAULT_MARKET);

  useEffect(() => {
    const { theme } = MARKETS[marketId];
    const root = document.documentElement;
    root.style.setProperty("--ig-primary", theme.primary);
    root.style.setProperty("--ig-accent", theme.accent);
    root.style.setProperty("--ig-glow", theme.glow);
    root.dataset.market = marketId;
  }, [marketId]);

  const setMarket = useCallback((id: MarketId) => setMarketId(id), []);
  const toggleMarket = useCallback(
    () => setMarketId((m) => (m === "US" ? "IN" : "US")),
    [],
  );

  const value = useMemo<MarketContextValue>(
    () => ({ marketId, market: MARKETS[marketId], setMarket, toggleMarket }),
    [marketId, setMarket, toggleMarket],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error("useMarket must be used within a MarketProvider");
  return ctx;
}
