import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

const requiredRelations = [
  "public.breeze_broker_syncs",
  "public.breeze_broker_snapshots",
  "public.breeze_instrument_map",
  "public.news_sources",
  "public.news_sync_state",
  "public.event_stock_map",
  "public.user_news_providers",
];
const client = new pg.Client({
  connectionString: url,
  ssl: /127\.0\.0\.1|localhost/.test(url) ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  const result = await client.query(
    "select name, to_regclass(name) relation from unnest($1::text[]) name",
    [requiredRelations],
  );
  const missing = result.rows.filter((row) => row.relation === null).map((row) => row.name);
  if (missing.length) throw new Error(`Required production relations are missing: ${missing.join(", ")}`);
  console.log(`Verified production schema: ${requiredRelations.join(", ")}`);
} catch (error) {
  console.error("Production schema verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
