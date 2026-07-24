// Ad-hoc progress reporter for the US OHLCV backfill queue.
// Prints one compact status line: counts, coverage, and whether a worker is live.
// Usage: node scripts/backfill-progress.mjs
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL || "postgresql://localhost:5432/investogenie";
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
});

await client.connect();
try {
  const q = async (sql) => (await client.query(sql)).rows[0];

  const queue = await q(`
    select
      count(*) filter (where status='pending')::int      as pending,
      count(*) filter (where status='in_progress')::int  as in_progress,
      count(*) filter (where status='done')::int         as done,
      count(*) filter (where status='failed')::int       as failed
    from public.backfill_queue where market='US'`);

  const cov = await q(`
    select
      (select count(distinct o.asset_id) from public.daily_ohlcv o
         join public.assets a on a.id=o.asset_id where a.country='US')::int as with_history,
      (select count(*) from public.latest_quotes qq
         join public.assets a on a.id=qq.asset_id
        where a.country='US'
          and not exists (select 1 from public.daily_ohlcv o where o.asset_id=qq.asset_id))::int as quote_no_history`);

  const total = queue.pending + queue.in_progress + queue.done + queue.failed;
  const settled = queue.done + queue.failed;
  const pct = total ? ((settled / total) * 100).toFixed(1) : "0.0";

  console.log(
    `pending=${queue.pending} in_progress=${queue.in_progress} done=${queue.done} ` +
      `failed=${queue.failed} (${pct}% settled) | US assets with history=${cov.with_history} ` +
      `quote-without-history=${cov.quote_no_history}`,
  );
} finally {
  await client.end();
}
