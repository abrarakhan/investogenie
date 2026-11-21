// Single shared pg connection pool + thin query helpers. Uses direct SQL
// against the local Postgres. A global
// singleton survives Next.js dev hot-reloads (which would otherwise leak pools).
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

const globalForPg = globalThis as unknown as { __igPool?: Pool };

export const pool: Pool =
  globalForPg.__igPool ??
  (globalForPg.__igPool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 10,
  }));

/** Run a query and return all rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

/** Run a query and return the first row, or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const res = await pool.query<T>(text, params);
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

export type RlsAccessContext = { kind: "tenant"; userId: string } | { kind: "worker" };

/**
 * Run database work through the non-owner web role with transaction-local RLS
 * context. Callers must choose tenant or worker explicitly; context can never
 * leak through a pooled connection because COMMIT/ROLLBACK clears SET LOCAL.
 */
export async function rlsTx<T>(
  context: RlsAccessContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role investogenie_web");
    if (context.kind === "tenant") {
      await client.query("select set_config('investogenie.user_id', $1, true)", [context.userId]);
    } else {
      await client.query("select set_config('investogenie.worker', 'on', true)");
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function tenantQuery<T extends QueryResultRow = QueryResultRow>(
  userId: string,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return rlsTx({ kind: "tenant", userId }, async (client) => (await client.query<T>(text, params)).rows);
}

export async function tenantQueryOne<T extends QueryResultRow = QueryResultRow>(
  userId: string,
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await tenantQuery<T>(userId, text, params);
  return rows[0] ?? null;
}

export async function workerQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return rlsTx({ kind: "worker" }, async (client) => (await client.query<T>(text, params)).rows);
}

export function getDatabaseUrl(): string {
  return url;
}
