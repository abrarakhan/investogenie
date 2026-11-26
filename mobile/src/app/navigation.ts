import type { MobileFeatureEntry } from "../features/registry";

export type DestinationKey = "home" | "discover" | "strategies" | "portfolio" | "more";

export interface DestinationSpec {
  key: DestinationKey;
  label: string;
  glyph: string;
}

export const DESTINATIONS: readonly DestinationSpec[] = [
  { key: "home", label: "Home", glyph: "◉" },
  { key: "discover", label: "Discover", glyph: "⌕" },
  { key: "strategies", label: "Strategies", glyph: "⚡" },
  { key: "portfolio", label: "Portfolio", glyph: "◫" },
  { key: "more", label: "More", glyph: "⋯" },
] as const;

export interface DeepLinkTarget {
  destination: DestinationKey;
  screenKey?: string;
}

const DISCOVER_KEYS = new Set(["stock-screener", "long-term"]);
const STRATEGY_KEYS = new Set([
  "strong-swing",
  "trend-continuation",
  "momentum-v2",
  "swing",
  "tactical-radar",
  "news-swing",
]);
const PORTFOLIO_KEYS = new Set(["trade-ledger"]);
const MORE_KEYS = new Set(["strategy-tests", "data-health"]);
const HOME_KEYS = new Set(["home", "market"]);

export function destinationForScreen(screenKey: string): DestinationKey {
  if (HOME_KEYS.has(screenKey)) return "home";
  if (DISCOVER_KEYS.has(screenKey)) return "discover";
  if (STRATEGY_KEYS.has(screenKey)) return "strategies";
  if (PORTFOLIO_KEYS.has(screenKey)) return "portfolio";
  if (MORE_KEYS.has(screenKey)) return "more";
  // Future server-driven card screens default to Strategies so they stay accessible without a native release.
  return "strategies";
}

export function featuresForDestination(
  screens: MobileFeatureEntry[],
  destination: DestinationKey,
): MobileFeatureEntry[] {
  return screens.filter((screen) => destinationForScreen(screen.key) === destination);
}

/**
 * Resolve a push notification payload into a destination + optional inner screen.
 * Unknown payloads default to Portfolio (Trade Ledger), matching prior behavior.
 */
export function resolveDeepLink(data?: Record<string, unknown> | null): DeepLinkTarget {
  const raw = typeof data?.screen === "string" ? data.screen.trim() : "";
  if (!raw) return { destination: "portfolio", screenKey: "trade-ledger" };
  if (raw === "home" || raw === "market") return { destination: "home", screenKey: raw };
  return { destination: destinationForScreen(raw), screenKey: raw };
}
