import "server-only";
/**
 * Shared, continuously refreshed cache for the market scans behind the display
 * screens (web Strong Swing / Armed Swing / Markets pages, mobile screens,
 * News & AI).
 *
 * The scans are server-authoritative and identical for every viewer with the
 * same risk settings, yet each page view re-ranked ~420 days of bars for the
 * whole market (6–13 s on production). Formulas, gates and rankings are
 * untouched; this only decides when they are recomputed.
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
 */
import type { SwingSettings } from "@/lib/settings";
import { getStrongSwingCandidates, type StrongSwingCandidate } from "@/features/strong-swing/service";
import { getMomentumBothCandidates, type MomentumBothResult } from "@/features/momentum/service";
import { getTrendContinuationCandidates, type TrendContinuationCandidate } from "@/features/trend-continuation/service";
import { getArmedSwingCandidates } from "@/features/armed-swing/service";
import { getSwingScreenBundle } from "@/features/swing/service";
import { getMarketOverview } from "@/lib/marketOverview";
import type { MarketId } from "@/lib/types";

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
  const pending = entry.compute().then(
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
  return refresh(key, entry, now) as Promise<T>;
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

/** Canonical key for grouping identical SwingSettings across caches and scheduled jobs. */
export const swingSettingsKey = (settings: SwingSettings) =>
  JSON.stringify(Object.keys(settings).sort().map((key) => [key, settings[key as keyof SwingSettings]]));

const settingsKey = swingSettingsKey;

/**
 * Prime an existing or new display cache entry with a freshly computed result (for example
 * from the 2-minute alert cron). Does not start a standing keep-warm timer on its own, so
 * idle screens stay quiet while active screens immediately receive the fresh scan.
 */
export function seedDisplayScanCache<T>(key: string, value: T, now: () => number = Date.now): void {
  const at = now();
  let entry = entries.get(key);
  if (!entry) {
    entry = { at, hasValue: true, value, compute: async () => value, lastRead: 0 };
    entries.set(key, entry);
    evictOverflow();
  } else {
    entry.value = value;
    entry.hasValue = true;
    entry.at = at;
  }
  if (typeof value === "object" && value !== null) computedAt.set(value, at);
}

function tagMomentumComputedAt(both: MomentumBothResult): MomentumBothResult {
  const at = displayScanComputedAt(both);
  if (at > 0) {
    computedAt.set(both.legacy, at);
    computedAt.set(both.v2, at);
  }
  return both;
}

export const displayStrongSwing = (market: MarketId, settings: SwingSettings) =>
  cachedForDisplay(`strong:${market}:${settingsKey(settings)}`, () => getStrongSwingCandidates(market, settings));
export const displayMomentumBoth = async (market: MarketId, settings: SwingSettings): Promise<MomentumBothResult> =>
  tagMomentumComputedAt(await cachedForDisplay(
    `momentum-both:${market}:${settingsKey(settings)}`,
    () => getMomentumBothCandidates(market, settings),
  ));
export const displayLegacyMomentum = async (market: MarketId, settings: SwingSettings) =>
  (await displayMomentumBoth(market, settings)).legacy;
export const displayMomentumV2 = async (market: MarketId, settings: SwingSettings) =>
  (await displayMomentumBoth(market, settings)).v2;
export const displayTrendContinuation = (market: MarketId, limit?: number) =>
  market !== "IN"
    ? Promise.resolve([] as TrendContinuationCandidate[])
    : cachedForDisplay(`trend:${market}:${limit ?? "default"}`, () => getTrendContinuationCandidates(market, limit));
export const displayArmedSwing = (market: MarketId, settings: SwingSettings) =>
  cachedForDisplay(`armed:${market}:${settingsKey(settings)}`, () => getArmedSwingCandidates(market, settings));
export const displaySwingBundle = (market: MarketId, settings: SwingSettings) =>
  cachedForDisplay(`swing:${market}:${settingsKey(settings)}`, () => getSwingScreenBundle(market, settings));
export const displayMarketOverview = (market: MarketId) =>
  cachedForDisplay(`markets:${market}`, () => getMarketOverview(market));

export const seedStrongSwing = (market: MarketId, settings: SwingSettings, value: StrongSwingCandidate[]) =>
  seedDisplayScanCache(`strong:${market}:${settingsKey(settings)}`, value);
export const seedMomentumBoth = (market: MarketId, settings: SwingSettings, value: MomentumBothResult) => {
  seedDisplayScanCache(`momentum-both:${market}:${settingsKey(settings)}`, value);
  tagMomentumComputedAt(value);
};
export const seedTrendContinuation = (market: MarketId, value: TrendContinuationCandidate[]) => {
  if (market === "IN") seedDisplayScanCache(`trend:${market}:default`, value);
};

/**
 * Non-blocking read of an already-warm display scan cache entry.
 * Never triggers a scan or background refresh when cold.
 */
export function peekDisplayScan<T>(key: string, now: () => number = Date.now): T | null {
  const entry = entries.get(key);
  if (!entry || !entry.hasValue) return null;
  if (now() - entry.at > DISPLAY_SCAN_MAX_AGE_MS * 4) return null;
  return entry.value as T;
}

export const peekStrongSwing = (market: MarketId, settings: SwingSettings) =>
  peekDisplayScan<StrongSwingCandidate[]>(`strong:${market}:${settingsKey(settings)}`);
