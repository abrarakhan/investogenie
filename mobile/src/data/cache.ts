import { Directory, File, Paths } from "expo-file-system";

const CACHE_ROOT = "ig-screen-cache";
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Only read-only market, screener, and strategy screens are persisted on disk.
 * Never add ledger, holdings, account, or broker screens to this allowlist.
 */
const CACHEABLE_SCREENS = new Set([
  "home",
  "market",
  "stock-screener",
  "swing",
  "strong-swing",
  "momentum-v2",
  "trend-continuation",
  "tactical-radar",
  "long-term",
]);

interface CachedEnvelope<T> {
  schemaVersion: number;
  savedAt: number;
  ttlMs: number;
  etag: string | null;
  payload: T;
}

export interface ScreenCacheEntry<T> {
  etag: string | null;
  savedAt: number;
  payload: T;
}

/**
 * True only for first-page requests to allowlisted read-only screens.
 * Cursor-paginated pages and sensitive endpoints are intentionally excluded.
 */
export function isCacheableScreenPath(path: string): boolean {
  const match = /^\/api\/v1\/mobile\/screens\/([^/?#]+)(\?.*)?$/.exec(path);
  if (!match) return false;
  const screenKey = decodeURIComponent(match[1]);
  if (!CACHEABLE_SCREENS.has(screenKey)) return false;
  const query = match[2] ?? "";
  return !/(?:^|[?&])cursor=/.test(query);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "user";
}

function hashKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function userDir(userId: string): Directory {
  return new Directory(Paths.cache, CACHE_ROOT, safeSegment(userId));
}

function cacheFile(userId: string, path: string): File {
  return new File(userDir(userId), `s_${hashKey(path)}.json`);
}

export async function readScreenCache<T>(userId: string, path: string): Promise<ScreenCacheEntry<T> | null> {
  if (!userId || !isCacheableScreenPath(path)) return null;
  try {
    const file = cacheFile(userId, path);
    if (!file.exists) return null;
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<CachedEnvelope<T>>;
    if (
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
      typeof parsed.savedAt !== "number" ||
      typeof parsed.ttlMs !== "number" ||
      parsed.payload === undefined
    ) {
      file.delete();
      return null;
    }
    if (Date.now() - parsed.savedAt > parsed.ttlMs) {
      file.delete();
      return null;
    }
    return {
      etag: typeof parsed.etag === "string" ? parsed.etag : null,
      savedAt: parsed.savedAt,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

export function writeScreenCache<T>(
  userId: string,
  path: string,
  etag: string | null,
  payload: T,
  ttlMs = DEFAULT_TTL_MS,
): void {
  if (!userId || !isCacheableScreenPath(path)) return;
  try {
    const dir = userDir(userId);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = cacheFile(userId, path);
    const envelope: CachedEnvelope<T> = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      savedAt: Date.now(),
      ttlMs,
      etag,
      payload,
    };
    file.write(JSON.stringify(envelope));
  } catch {
    // Disk cache is best-effort; never fail a live screen fetch.
  }
}

export function clearScreenCache(userId?: string): void {
  try {
    const target = userId ? userDir(userId) : new Directory(Paths.cache, CACHE_ROOT);
    if (target.exists) target.delete();
  } catch {
    // Best-effort cleanup on logout.
  }
}
