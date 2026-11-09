import "server-only";
/**
 * 60-second shared cache for the market scans behind the display screens
 * (web Strong Swing / Armed Swing / Markets pages, mobile screens, News & AI).
 *
 * The scans are server-authoritative and identical for every viewer with the
 * same risk settings, yet each page view re-ranked ~420 days of bars for the
 * whole market (6–13 s on production). Results change only when quotes change,
 * which the market-hours refresh does every 2 minutes, so a 60 s reuse window
 * bounds staleness well inside that cycle. Formulas, gates and rankings are
 * untouched; this only decides when they are recomputed.
 *
 * Not used by alerts, auto-buy or the email digest, which keep computing fresh.
 * Concurrent requests for the same key share one in-flight computation; a
 * failure is never cached. Cached values are shared, so callers must not
 * mutate them (current callers copy before sorting).
 */
import type { SwingSettings } from "@/lib/settings";
import { getStrongSwingCandidates } from "@/lib/strongSwing";
import { getMomentumIgnitionCandidates as getLegacyMomentumIgnitionCandidates } from "@/lib/momentumIgnitionLegacy";
import { getMomentumIgnitionCandidates } from "@/lib/momentumIgnition";
import { getTrendContinuationCandidates } from "@/lib/trendContinuation";
import { getArmedSwingCandidates } from "@/lib/armedSwing";
import { getMarketOverview } from "@/lib/marketOverview";
import type { MarketId } from "@/lib/types";

export const DISPLAY_SCAN_TTL_MS = 60_000;
const MAX_ENTRIES = 200;

interface Entry { at: number; value?: unknown; pending?: Promise<unknown> }
const entries = new Map<string, Entry>();

export async function cachedForDisplay<T>(key: string, compute: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const hit = entries.get(key);
  if (hit?.pending) return hit.pending as Promise<T>;
  if (hit && "value" in hit && now() - hit.at < DISPLAY_SCAN_TTL_MS) return hit.value as T;
  const pending = compute().then(
    (value) => {
      entries.set(key, { at: now(), value });
      return value;
    },
    (error) => {
      entries.delete(key);
      throw error;
    },
  );
  entries.set(key, { at: hit?.at ?? 0, pending });
  if (entries.size > MAX_ENTRIES) {
    const oldest = [...entries.entries()].filter(([, entry]) => !entry.pending).sort((a, b) => a[1].at - b[1].at);
    for (const [staleKey] of oldest.slice(0, entries.size - MAX_ENTRIES)) entries.delete(staleKey);
  }
  return pending;
}

/** Test-only reset. */
export function resetDisplayScanCache(): void {
  entries.clear();
}

const settingsKey = (settings: SwingSettings) =>
  JSON.stringify(Object.keys(settings).sort().map((key) => [key, settings[key as keyof SwingSettings]]));

export const displayStrongSwing = (market: MarketId, settings: SwingSettings) =>
  cachedForDisplay(`strong:${market}:${settingsKey(settings)}`, () => getStrongSwingCandidates(market, settings));
export const displayLegacyMomentum = (market: MarketId, settings: SwingSettings) =>
  cachedForDisplay(`momentum-legacy:${market}:${settingsKey(settings)}`, () => getLegacyMomentumIgnitionCandidates(market, settings));
export const displayMomentumV2 = (market: MarketId, settings: SwingSettings) =>
  cachedForDisplay(`momentum-v2:${market}:${settingsKey(settings)}`, () => getMomentumIgnitionCandidates(market, settings));
export const displayTrendContinuation = (market: MarketId, limit?: number) =>
  cachedForDisplay(`trend:${market}:${limit ?? "default"}`, () => getTrendContinuationCandidates(market, limit));
export const displayArmedSwing = (market: MarketId, settings: SwingSettings) =>
  cachedForDisplay(`armed:${market}:${settingsKey(settings)}`, () => getArmedSwingCandidates(market, settings));
export const displayMarketOverview = (market: MarketId) =>
  cachedForDisplay(`markets:${market}`, () => getMarketOverview(market));
