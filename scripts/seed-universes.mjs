// Seed public.universe_members from the static JSON lists in db/universes/.
// Each file is { universe, country, source, symbols[] }. Symbols are resolved to
// asset_id against public.assets (preferring the NSE/primary listing); symbols
// with no matching tracked asset (e.g. index underlyings in the F&O list) are
// reported and skipped. Re-runnable: it replaces each universe's rows wholesale.
//
//   DATABASE_URL=postgresql://127.0.0.1:5432/investogenie node scripts/seed-universes.mjs
//
// Refresh the lists from source before seeding (URLs live in each JSON's
// "source" field and in README-screener.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "db", "universes");

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/investogenie";
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const files = fs.readdirSync(SEED_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const seed = JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), "utf8"));
      const { universe, country, symbols } = seed;
      if (!universe || !country || !Array.isArray(symbols)) {
        console.warn(`  skip ${file}: malformed seed`);
        continue;
      }
      // Resolve each symbol to one asset_id, preferring the NSE listing for IN.
      const resolved = await client.query(
        `select distinct on (upper(a.ticker)) upper(a.ticker) as sym, a.id
           from public.assets a
          where a.country = $1 and a.asset_class = 'STOCK' and a.is_active
            and upper(a.ticker) = any($2::text[])
          order by upper(a.ticker), case when a.exchange = 'NSE' then 0 else 1 end, a.created_at`,
        [country, symbols.map((s) => String(s).toUpperCase())],
      );
      const idBySym = new Map(resolved.rows.map((r) => [r.sym, r.id]));
      const matched = symbols.filter((s) => idBySym.has(String(s).toUpperCase()));
      const missing = symbols.filter((s) => !idBySym.has(String(s).toUpperCase()));

      await client.query("begin");
      await client.query("delete from public.universe_members where universe = $1", [universe]);
      if (matched.length) {
        const values = matched
          .map((_, i) => `($1, $2, $${i * 2 + 3}, $${i * 2 + 4})`)
          .join(", ");
        const params = [universe, country];
        for (const s of matched) {
          params.push(String(s).toUpperCase(), idBySym.get(String(s).toUpperCase()));
        }
        await client.query(
          `insert into public.universe_members (universe, country, symbol, asset_id) values ${values}
           on conflict (universe, symbol) do update set asset_id = excluded.asset_id, country = excluded.country`,
          params,
        );
      }
      await client.query("commit");
      console.log(
        `${universe.padEnd(10)} ${country}  seeded ${matched.length}/${symbols.length}` +
          (missing.length ? `  (unmatched: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""})` : ""),
      );
    }
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
