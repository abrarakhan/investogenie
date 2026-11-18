import "server-only";
/**
 * Shared, continuously refreshed cache for the market scans behind the display
 * screens (web Strong Swing / Armed Swing / Markets pages, mobile screens,
 * News & AI).
 *
 * The scans are server-authoritative and identical for every viewer with the
 * same risk settings, yet each page view re-ranks ~420 days of bars for the
 * whole market. Formulas, gates and rankings are untouched; this only decides
 * when they are recomputed.
 *
 * Cost of one such scan, measured on production (2 vCPU) during market hours
 * on 2026-11-18: ~20 s warm, ~53 s cold. The 6–13 s this comment used to quote
 * no longer held — daily_ohlcv had grown to ~9.1M rows and the planner was
 * seq-scanning it because random_page_cost was still 4 on SSD storage (now 1.1
 * for the app role, which cut a warm scan from ~80 s to ~20 s). Re-measure
 * before assuming a scan is cheap enough to run per request.
 *
 * Stale-while-revalidate with keep-warm:
 *  - A result is fresh for DISPLAY_SCAN_TTL_MS (60 s).
 *  - When it turns 60 s old, it is recomputed in the background as long as
 *    someone read it within KEEP_WARM_MS, so active screens never wait for a
 *    scan. Served results are normally at most ~60 s + one scan old.
 *  - Readers keep getting the previous result for up to DISPLAY_SCAN_MAX_AGE_MS
 *    while a refresh runs (or if one fails). Past that, or for a screen nobody
 *    has opened recently, the reader waits for a fresh scan.
 *
 * Not used by alerts, auto-buy or the email digest, which keep computing fresh.
 * Concurrent requests share one in-flight computation; a failure is never
 * cached. Cached values are shared, so callers must not mutate them (current
 * callers copy before sorting).
 *
 * Two properties keep a slow host from turning a slow screen into a dead one:
 *  - Scans run on the capped display pool, so a render the browser abandoned
 *    stops costing database CPU instead of running to completion unread.
 *  - When a refresh fails and a previous result exists, that result is served
 *    rather than throwing. Without this a failed scan left nothing cached, so
 *    the next reader recomputed everything from scratch on an already
 *    overloaded host and failed in turn. Callers must surface the age: the
 *    served result can be older than DISPLAY_SCAN_MAX_AGE_MS, and
 *    displayScanComputedAt reports when it was actually computed.
 */
import { runOnDisplayPool } from "@/lib/db";
import type { SwingSettings } from "@/lib/settings";
import { getStrongSwingCandidates } from "@/features/strong-swing/service";
import { getMomentumLegacyCandidates, getMomentumV2Candidates } from "@/features/momentum/service";
import { getTrendContinuationCandidates } from "@/features/trend-continuation/service";
import { getArmedSwingCandidates } from "@/features/armed-swing/service";
import { getMarketOverview } from "@/lib/marketOverview";
import type { MarketId } from "@/lib/types";

const getMomentumIgnitionCandidates = getMomentumV2Candidates;
const getLegacyMomentumIgnitionCandidates = getMomentumLegacyCandidates;

export const DISPLAY_SCAN_TTL_MS = 60_000;
/** Oldest result served while a background refresh runs or after it failed. */
export const DISPLAY_SCAN_MAX_AGE_MS = 3 * 60_000;
/** Keep refreshing a screen in the background for this long after its last read. */
export const DISPLAY_SCAN_KEEP_WARM_MS = 5 * 60_000;
const MAX_ENTRIES = 200;

interface Entry {
  at: number;
  hasValue: boolean;
  value?: unknown;
  pending?: Promise<unknown>;
  compute: () => Promise<unknown>;
  lastRead: number;
  timer?: ReturnType<typeof setTimeout>;
}
// Held on globalThis so the start-up warm-up (instrumentation bundle) and the
// pages (app bundle) share one cache inside the same server process.
const store = ((globalThis as { __investogenieDisplayScans?: { entries: Map<string, Entry>; computedAt: WeakMap<object, number> } })
  .__investogenieDisplayScans ??= { entries: new Map(), computedAt: new WeakMap() });
const entries = store.entries;
const computedAt = store.computedAt;

/** When a cached display scan result was computed; changes only when the scan is recomputed. */
export function displayScanComputedAt(value: unknown): number {
  return typeof value === "object" && value !== null ? computedAt.get(value) ?? 0 : 0;
}

function refresh(key: string, entry: Entry, now: () => number): Promise<unknown> {
  if (entry.pending) return entry.pending;
  const pending = runOnDisplayPool(() => entry.compute()).then(
    (value) => {
      entry.value = value;
      entry.hasValue = true;
      entry.at = now();
      if (typeof value === "object" && value !== null) computedAt.set(value, entry.at);
      entry.pending = undefined;
      scheduleKeepWarm(key, entry, now);
      return value;
    },
    (error) => {
      entry.pending = undefined;
      // Keep serving the last good result until it ages out; never cache the failure.
      if (!entry.hasValue && entries.get(key) === entry) entries.delete(key);
      throw error;
    },
  );
  entry.pending = pending;
  return pending;
}

function scheduleKeepWarm(key: string, entry: Entry, now: () => number): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (entries.get(key) !== entry || now() - entry.lastRead >= DISPLAY_SCAN_KEEP_WARM_MS) return;
    refresh(key, entry, now).catch((error) => {
      console.warn(`[display-scan] background refresh failed for ${key.split(":", 2).join(":")}:`, error instanceof Error ? error.message : error);
    });
  }, DISPLAY_SCAN_TTL_MS);
  entry.timer.unref?.();
}

export async function cachedForDisplay<T>(key: string, compute: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  let entry = entries.get(key);
  if (!entry) {
    entry = { at: 0, hasValue: false, compute, lastRead: now() };
    entries.set(key, entry);
    evictOverflow();
  }
  entry.compute = compute;
  entry.lastRead = now();
  if (entry.hasValue) {
    const age = now() - entry.at;
    if (age < DISPLAY_SCAN_TTL_MS) return entry.value as T;
    if (age < DISPLAY_SCAN_MAX_AGE_MS) {
      // Serve the previous result immediately; the next read gets the new one.
      refresh(key, entry, now).catch(() => {});
      return entry.value as T;
    }
  }
  try {
    return (await refresh(key, entry, now)) as T;
  } catch (error) {
    // A stale result beats no screen at all; the caller shows how old it is.
    if (entry.hasValue && entries.get(key) === entry) {
      console.warn(
        `[display-scan] serving stale result for ${key.split(":", 2).join(":")}:`,
        error instanceof Error ? error.message : error,
      );
      return entry.value as T;
    }
    throw error;
  }
}

function evictOverflow(): void {
  if (entries.size <= MAX_ENTRIES) return;
  const idle = [...entries.entries()].filter(([, entry]) => !entry.pending).sort((a, b) => a[1].lastRead - b[1].lastRead);
  for (const [key, entry] of idle.slice(0, entries.size - MAX_ENTRIES)) {
    if (entry.timer) clearTimeout(entry.timer);
    entries.delete(key);
  }
}

/** Test-only reset. */
export function resetDisplayScanCache(): void {
  for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer);
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
