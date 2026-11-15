export interface MobileFeatureEntry {
  key: string;
  title: string;
  tabLabel: string;
  kind: "native" | "cards";
}

/**
 * Mobile navigation manifest. Server-driven card screens need no native release;
 * dedicated screens are admitted only when this build declares an implementation.
 */
export const MOBILE_FEATURES: MobileFeatureEntry[] = [
  { key: "market", title: "Market Overview", tabLabel: "Market", kind: "cards" },
  { key: "stock-screener", title: "Stock Screener", tabLabel: "Screener", kind: "cards" },
  { key: "swing", title: "Swing Candidates", tabLabel: "Swing", kind: "cards" },
  { key: "strong-swing", title: "Strong Swing", tabLabel: "Strong", kind: "cards" },
  { key: "momentum-v2", title: "Momentum Ignition V2", tabLabel: "Momentum", kind: "cards" },
  { key: "trend-continuation", title: "Trend Continuation", tabLabel: "Continuation", kind: "cards" },
  { key: "armed-swing", title: "Armed Strong Swing", tabLabel: "Armed", kind: "cards" },
  { key: "news-swing", title: "News & AI Swing", tabLabel: "News & AI", kind: "native" },
  { key: "long-term", title: "Long-Term Candidates", tabLabel: "Long-Term", kind: "cards" },
  { key: "trade-ledger", title: "Trade Ledger", tabLabel: "Ledger", kind: "native" },
];

export const NATIVE_FEATURE_KEYS = new Set(["news-swing", "trade-ledger"]);

export function supportedMobileFeatures<T extends MobileFeatureEntry>(catalog: T[]): T[] {
  return catalog.filter((feature) => feature.kind === "cards" || NATIVE_FEATURE_KEYS.has(feature.key));
}
