// Removes junk holdings created by earlier buggy CAS-statement imports:
//   1. holdings on CAS assets whose name is a footnote/header/total line
//      (e.g. "Sub Total", "*Due to change in fundamental attributes ..."),
//   2. holdings on CAS assets whose quantity/avg_cost are implausible for a
//      retail holding (folio numbers or concatenated digits parsed as units),
//   3. stale 'CAS'-sourced latest_quotes for the affected assets,
//   4. junk-named CAS assets themselves (plus their mutual_fund_meta /
//      user_mutual_fund_holdings rows) once no holdings reference them.
// Real assets with bad numbers keep their assets row — re-importing the CAS
// statement with the fixed parser repopulates them correctly.
//
// Usage: DATABASE_URL=... node scripts/cleanup-cas-junk.mjs --user <uuid> [--dry-run]
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgresql://localhost:5432/investogenie";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const userIdx = args.indexOf("--user");
const userId = userIdx >= 0 ? args[userIdx + 1] : null;
if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
  console.error("Usage: node scripts/cleanup-cas-junk.mjs --user <uuid> [--dry-run]");
  process.exit(1);
}

// Keep in sync with JUNK_TEXT_RE in app/terminal/in/cas/actions.ts.
const JUNK_NAME_SQL = [
  "sub ?total",
  "grand ?total",
  "opening balance",
  "closing balance",
  "^[-\\s]*page\\M",
  "page \\d+ of \\d+",
  "statement for the period",
  "transaction statement",
  "consolidated account statement",
  "fundamental attribute",
  "has been (changed|renamed|merged)",
  "mutual funds? folios?",
  "mutual funds? \\([a-z]\\)",
  "due to change",
  "\\mnomination\\M",
  "\\mkyc\\M",
  "registered office",
  "\\mdisclaimer\\M",
  "please note",
  "this statement",
].join("|");

// Mirrors HOLDING_BOUNDS / MAX_HOLDING_VALUE in the import action.
const IMPLAUSIBLE_HOLDING_SQL = `
  case when a.asset_class = 'MUTUAL_FUND'::asset_class
       then h.quantity > 1e6
         or coalesce(h.avg_cost, 10) not between 1 and 25000
         or h.quantity * coalesce(h.avg_cost, 10) > 1e9
       else h.quantity > 1e7
         or coalesce(h.avg_cost, 100) not between 0.05 and 1e6
         or h.quantity * coalesce(h.avg_cost, 100) > 1e9
  end`;

const client = new pg.Client({
  connectionString: url,
  ssl: /127\.0\.0\.1|localhost/.test(url) ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("begin");

  const { rows: junkAssets } = await client.query(
    `select id, ticker, name from public.assets a
      where a.exchange in ('CAS_MF', 'CAS_STOCK') and a.name ~* $1`,
    [JUNK_NAME_SQL],
  );
  const junkAssetIds = junkAssets.map((r) => r.id);

  const { rows: badHoldings } = await client.query(
    `select h.asset_id, a.ticker, a.name, h.quantity, h.avg_cost
       from public.holdings h
       join public.assets a on a.id = h.asset_id
      where h.user_id = $1
        and a.exchange in ('CAS_MF', 'CAS_STOCK')
        and (a.id = any($2) or ${IMPLAUSIBLE_HOLDING_SQL})`,
    [userId, junkAssetIds],
  );
  const badAssetIds = badHoldings.map((r) => r.asset_id);

  console.log(`Junk-named CAS assets: ${junkAssets.length}`);
  for (const a of junkAssets) console.log(`  [asset]   ${a.ticker}  ${a.name.slice(0, 60)}`);
  console.log(`Holdings to delete for user ${userId}: ${badHoldings.length}`);
  for (const h of badHoldings) {
    console.log(`  [holding] ${h.ticker}  qty=${h.quantity} avg_cost=${h.avg_cost}`);
  }

  const deletedHoldings = await client.query(
    "delete from public.holdings where user_id = $1 and asset_id = any($2)",
    [userId, badAssetIds],
  );
  const deletedXray = await client.query(
    `delete from public.user_mutual_fund_holdings
      where user_id = $1 and (fund_asset_id = any($2) or stock_asset_id = any($2))`,
    [userId, junkAssetIds],
  );
  const deletedQuotes = await client.query(
    "delete from public.latest_quotes where source = 'CAS' and asset_id = any($1)",
    [badAssetIds.concat(junkAssetIds)],
  );

  // Junk-named assets no one holds any more: strip their metadata and drop
  // them one by one, skipping any that some other table still references.
  const { rows: removable } = await client.query(
    `select a.id, a.ticker from public.assets a
      where a.id = any($1)
        and not exists (select 1 from public.holdings h where h.asset_id = a.id)`,
    [junkAssetIds],
  );
  let droppedAssets = 0;
  const skipped = [];
  for (const a of removable) {
    await client.query("savepoint drop_asset");
    try {
      await client.query("delete from public.mutual_fund_meta where asset_id = $1", [a.id]);
      await client.query("delete from public.latest_quotes where asset_id = $1", [a.id]);
      await client.query(
        "delete from public.user_mutual_fund_holdings where fund_asset_id = $1 or stock_asset_id = $1",
        [a.id],
      );
      await client.query("delete from public.assets where id = $1", [a.id]);
      droppedAssets++;
    } catch (err) {
      await client.query("rollback to savepoint drop_asset");
      skipped.push(`${a.ticker}: ${err.message}`);
    }
  }

  console.log(`\nDeleted holdings: ${deletedHoldings.rowCount}`);
  console.log(`Deleted user_mutual_fund_holdings rows: ${deletedXray.rowCount}`);
  console.log(`Deleted CAS latest_quotes rows: ${deletedQuotes.rowCount}`);
  console.log(`Dropped junk assets: ${droppedAssets}`);
  for (const s of skipped) console.log(`  [kept, still referenced] ${s}`);

  if (dryRun) {
    await client.query("rollback");
    console.log("\nDry run — rolled back.");
  } else {
    await client.query("commit");
    console.log("\nCommitted.");
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("Cleanup failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
