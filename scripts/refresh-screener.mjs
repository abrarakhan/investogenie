// Rebuild the screener snapshot (public.stock_snapshot) from the CLI. Mirrors
// the cron path (/api/cron/refresh-screener) but runs directly against Postgres
// so you can refresh locally without the server up.
//
//   DATABASE_URL=postgresql://127.0.0.1:5432/investogenie node scripts/refresh-screener.mjs [US|IN]
//
// With no argument it rebuilds both markets. Atomic: truncate/delete + insert in
// one transaction so readers never see a half-built table.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(__dirname, "..", "db", "screener_snapshot_rebuild.sql"), "utf8");

async function main() {
  const arg = (process.argv[2] || "").toUpperCase();
  const market = arg === "US" || arg === "IN" ? arg : null;
  const databaseUrl = process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/investogenie";
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  const t0 = Date.now();
  try {
    await client.query("begin");
    if (market) {
      await client.query("delete from public.stock_snapshot where country = $1", [market]);
    } else {
      await client.query("truncate public.stock_snapshot");
    }
    const res = await client.query(SQL, [market]);
    await client.query("commit");
    console.log(`Refreshed ${res.rowCount} rows (${market ?? "ALL"}) in ${Date.now() - t0}ms`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
