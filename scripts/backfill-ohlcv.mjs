#!/usr/bin/env node
// Trigger one queued OHLCV backfill batch through the local Next API.
// Requires the app to be running so the same server-side worker and logging path
// is used as the Data Health button and startup wrapper cron.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is required to trigger /api/backfill/run from the CLI.");
  process.exit(1);
}

const base = process.env.APP_URL ?? "http://127.0.0.1:3000";
const response = await fetch(`${base}/api/backfill/run?job=cron`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});
const text = await response.text();
console.log(text);
if (!response.ok && response.status !== 409) process.exit(1);
