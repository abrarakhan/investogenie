import pg from "pg";
import { readinessMarkets } from "./strategy-readiness-policy.mjs";

let markets;
try {
  markets = readinessMarkets(process.argv.slice(2));
} catch (error) {
  console.error(`Usage: npm run audit:strategy-readiness -- --market IN|US|ALL\n${error.message}`);
  process.exit(2);
}

if (process.env.NODE_ENV !== "production" && process.env.DOTENV_CONFIG_PATH === undefined) {
  try { process.loadEnvFile(".env.local"); } catch { /* optional */ }
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
});
let failed = false;
try {
  for (const market of markets) {
    const captures = await pool.query(
      `select captured_at,count(*) rows,
              count(*) filter(where status='EXECUTION_READY') ready,
              count(*) filter(where coalesce((metrics->'resultsCheck'->>'verified')::boolean,false)) results_verified
         from public.strong_swing_snapshots
        where market=$1 and source='scheduled' and metrics->>'modelVersion'='strong-swing-v4-breakout-bar'
        group by captured_at order by captured_at desc limit 5`, [market],
    );
    const enough = captures.rows.length >= 5;
    const total = captures.rows.reduce((sum, row) => sum + Number(row.rows), 0);
    const ready = captures.rows.reduce((sum, row) => sum + Number(row.ready), 0);
    const verified = captures.rows.reduce((sum, row) => sum + Number(row.results_verified), 0);
    const coverage = total ? verified / total : 0;
    console.log(`[readiness] ${market} Strong Swing: ${captures.rows.length}/5 captures, ${ready} ready, results coverage ${(coverage * 100).toFixed(1)}%`);
    if (!enough || ready < captures.rows.length || (market === "IN" && coverage < 0.9)) failed = true;

    const curve = await pool.query(
      `select version,sample_sessions,sample_from,sample_through from public.market_volume_curves
        where market=$1 and active and sample_sessions>=40 order by generated_at desc limit 1`, [market],
    );
    console.log(`[readiness] ${market} Armed curve: ${curve.rows[0]?.version ?? "MISSING"}`);
    if (!curve.rows.length) failed = true;
  }
} finally {
  await pool.end();
}
if (failed) {
  console.error("[readiness] FAILED: keep affected strategies in shadow/fail-closed mode");
  process.exit(1);
}
console.log("[readiness] PASS");
