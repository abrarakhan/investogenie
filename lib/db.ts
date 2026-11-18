// Single shared pg connection pool + thin query helpers. Uses direct SQL
// against the local Postgres. A global
// singleton survives Next.js dev hot-reloads (which would otherwise leak pools).
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie";

function resolveDatabaseUrl(value: string | undefined): string {
  if (!value) return DEFAULT_DATABASE_URL;

  try {
    const parsed = new URL(value);
    const isLocalHost =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (isLocalHost && parsed.port === "54322") {
      return DEFAULT_DATABASE_URL;
    }
  } catch {
    return value;
  }

  return value;
}

const url = resolveDatabaseUrl(process.env.DATABASE_URL);

const isLocal = /127\.0\.0\.1|localhost/.test(url);

const globalForPg = globalThis as unknown as { __igPool?: Pool; __igDisplayPool?: Pool };

export const pool: Pool =
  globalForPg.__igPool ??
  (globalForPg.__igPool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 10,
  }));

/**
 * Separate pool for the display screens, with a per-statement cap.
 *
 * A page render that the browser abandons (nginx logs 499) does not cancel the
 * query behind it: with the server default of statement_timeout=0 the scan runs
 * to completion on a 2-vCPU host, so every reload of a slow page *adds* work.
 * Capping the statement makes an abandoned render stop costing CPU.
 *
 * The cap lives on its own pool, reached only through runOnDisplayPool, because
 * the same scan functions also serve alerts, auto-buy and the cron routes
 * (notably the screener snapshot rebuild), which legitimately run single
 * statements for minutes and must keep the uncapped pool.
 */
export const DISPLAY_STATEMENT_TIMEOUT_MS = Number(
  process.env.PG_DISPLAY_STATEMENT_TIMEOUT_MS ?? 45_000,
);

export const displayPool: Pool =
  globalForPg.__igDisplayPool ??
  (globalForPg.__igDisplayPool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 6,
    // Both are sent in the startup packet, so they apply to every statement on
    // the connection and cannot leak back into the main pool.
    statement_timeout: DISPLAY_STATEMENT_TIMEOUT_MS,
    // Parallel query turns one scan into three processes. That is a good trade
    // on an idle host and a bad one on two vCPUs during market hours, when
    // three concurrent display scans became nine competing backends. Scoped to
    // this pool so the nightly rebuilds and backfills keep their parallelism.
    options: "-c max_parallel_workers_per_gather=0",
  }));

const poolStore = new AsyncLocalStorage<Pool>();

/**
 * Run `fn` with every query() / queryOne() inside it issued on the capped
 * display pool. Writes via tx() always stay on the main pool.
 */
export function runOnDisplayPool<T>(fn: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(DISPLAY_STATEMENT_TIMEOUT_MS) || DISPLAY_STATEMENT_TIMEOUT_MS <= 0) return fn();
  return poolStore.run(displayPool, fn);
}

/** The pool the current call path should read through. */
function readPool(): Pool {
  return poolStore.getStore() ?? pool;
}

/** Run a query and return all rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await readPool().query<T>(text, params);
  return res.rows;
}

/** Run a query and return the first row, or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const res = await readPool().query<T>(text, params);
  return res.rows[0] ?? null;
}

/** Run several statements in a transaction. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function getDatabaseUrl(): string {
  return url;
}
