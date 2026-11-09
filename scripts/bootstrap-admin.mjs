#!/usr/bin/env node
// Promote the deployment owner (DEFAULT_USER_EMAIL) to ADMIN. Run after
// migrations on every deploy. Fails — and so fails the deployment — when the
// variable is unset or matches no account; it never falls back to another
// user (for example the oldest). It only promotes, never demotes.
import pg from "pg";

const url = process.env.DATABASE_URL;
const owner = process.env.DEFAULT_USER_EMAIL?.trim();
if (!url) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}
if (!owner) {
  console.error("bootstrap-admin: DEFAULT_USER_EMAIL is not set; refusing to choose an admin.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: /127\.0\.0\.1|localhost/.test(url) ? false : { rejectUnauthorized: false },
});
try {
  await client.connect();
  const matches = await client.query("select id, role from public.users where lower(email) = lower($1)", [owner]);
  if (matches.rowCount !== 1) {
    console.error(`bootstrap-admin: DEFAULT_USER_EMAIL matches ${matches.rowCount} accounts; expected exactly 1.`);
    process.exitCode = 1;
  } else if (matches.rows[0].role === "ADMIN") {
    console.log("bootstrap-admin: owner already ADMIN.");
  } else {
    await client.query("update public.users set role = 'ADMIN' where id = $1", [matches.rows[0].id]);
    console.log("bootstrap-admin: owner promoted to ADMIN.");
  }
  const admins = await client.query("select count(*)::int n from public.users where role = 'ADMIN'");
  console.log(`bootstrap-admin: ${admins.rows[0].n} admin account(s).`);
} catch (error) {
  console.error("bootstrap-admin failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
