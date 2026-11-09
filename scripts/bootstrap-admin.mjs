#!/usr/bin/env node
// Make the deployment owner (DEFAULT_USER_EMAIL) an ADMIN and the single
// canonical system owner. Run after migrations on every deploy. Fails — and so
// fails the deployment — when the variable is unset or matches anything other
// than exactly one account; it never falls back to another user (for example
// the oldest). It never demotes an ADMIN. If DEFAULT_USER_EMAIL now names a
// different account, the owner flag moves to it (explicit configuration).
import pg from "pg";

const url = process.env.DATABASE_URL;
const owner = process.env.DEFAULT_USER_EMAIL?.trim();
if (!url) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}
if (!owner) {
  console.error("bootstrap-admin: DEFAULT_USER_EMAIL is not set; refusing to choose an owner.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: /127\.0\.0\.1|localhost/.test(url) ? false : { rejectUnauthorized: false },
});
try {
  await client.connect();
  await client.query("begin");
  const matches = await client.query(
    "select id, role, is_system_owner from public.users where lower(email) = lower($1) for update",
    [owner],
  );
  if (matches.rowCount !== 1) {
    await client.query("rollback");
    console.error(`bootstrap-admin: DEFAULT_USER_EMAIL matches ${matches.rowCount} accounts; expected exactly 1.`);
    process.exitCode = 1;
  } else {
    const target = matches.rows[0];
    const moved = await client.query(
      "update public.users set is_system_owner = false where is_system_owner and id <> $1 returning id",
      [target.id],
    );
    await client.query("update public.users set role = 'ADMIN', is_system_owner = true where id = $1", [target.id]);
    await client.query("commit");
    if (moved.rowCount) console.warn("bootstrap-admin: system owner moved to the account named by DEFAULT_USER_EMAIL.");
    console.log(target.role === "ADMIN" && target.is_system_owner
      ? "bootstrap-admin: owner already ADMIN and system owner."
      : "bootstrap-admin: owner set as ADMIN and system owner.");
  }
  const summary = await client.query(
    "select count(*) filter (where role = 'ADMIN')::int admins, count(*) filter (where is_system_owner)::int owners from public.users",
  );
  console.log(`bootstrap-admin: ${summary.rows[0].admins} admin account(s), ${summary.rows[0].owners} system owner.`);
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error("bootstrap-admin failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
