#!/usr/bin/env node
// Deployment preflight: run before building or migrating, so a missing
// authorization setting stops the deploy while the running release is
// untouched. Checks the required settings and that DEFAULT_USER_EMAIL names
// exactly one existing account. Never prints the email or any secret.
import pg from "pg";
import { deploymentEnvErrors } from "./deploy-env-check.mjs";

const errors = deploymentEnvErrors(process.env);
const url = process.env.DATABASE_URL;
if (!url) errors.push("DATABASE_URL is not set.");

if (!errors.length) {
  const client = new pg.Client({
    connectionString: url,
    ssl: /127\.0\.0\.1|localhost/.test(url) ? false : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select count(*)::int n from public.users where lower(email) = lower($1)",
      [process.env.DEFAULT_USER_EMAIL.trim()],
    );
    if (rows[0].n !== 1) errors.push(`DEFAULT_USER_EMAIL matches ${rows[0].n} accounts; expected exactly 1.`);
  } catch (error) {
    errors.push(`Could not verify DEFAULT_USER_EMAIL: ${error.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (errors.length) {
  for (const error of errors) console.error(`deploy preflight: ${error}`);
  console.error("deploy preflight: fix /etc/investogenie/investogenie.env; nothing was built, migrated or restarted.");
  process.exit(1);
}
console.log("deploy preflight: authorization settings OK.");
