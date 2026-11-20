// Rebuild public.eod_asset_features for IN, US, or ALL.
// Usage: node --import ./scripts/ts-alias-hook.mjs scripts/refresh-eod-features.mjs [IN|US|ALL]
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const arg = (process.argv[2] ?? "ALL").toUpperCase();
const markets = arg === "IN" || arg === "US" ? [arg] : ["IN", "US"];

const { refreshEodAssetFeatures } = await import("@/lib/eodAssetFeatures");

for (const market of markets) {
  const started = Date.now();
  const meta = await refreshEodAssetFeatures(market);
  const ms = Date.now() - started;
  if (!meta) {
    console.log(`[eod-features] ${market}: no completed bars found (${ms}ms)`);
  } else {
    console.log(`[eod-features] ${market}: materialized ${meta.rowCount} assets (latest=${meta.latestBarDate}, cutoff=${meta.cutoffDate}) in ${ms}ms`);
  }
}

process.exit(0);
