// Read-only audit for InvestoGenie's PostgreSQL tenant boundary.
// Usage: DATABASE_URL=... npm run security:rls:audit
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const bootstrapExclusions = new Set(["mobile_sessions", "password_reset_tokens"]);
const requiredIndirectTables = ["adaptive_allocation_runs", "forward_test_positions"];
const client = new pg.Client({
  connectionString: url,
  ssl: /127\.0\.0\.1|localhost/.test(url) ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  const role = (await client.query(
    `select r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolbypassrls,
            pg_has_role(current_user,r.oid,'MEMBER') member
       from pg_roles r where r.rolname='investogenie_web'`,
  )).rows[0];
  if (!role) throw new Error("investogenie_web role is missing");
  const unsafeRoleFlags = role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.rolcanlogin || role.rolbypassrls;
  if (unsafeRoleFlags || !role.member) {
    throw new Error(`investogenie_web role is unsafe or unavailable: ${JSON.stringify(role)}`);
  }

  const direct = (await client.query(
    `select c.relname,c.relrowsecurity,
            exists (
              select 1 from pg_policy p
               where p.polrelid=c.oid
                 and p.polroles @> array[(select oid from pg_roles where rolname='investogenie_web')]
            ) policy_ready
       from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       join information_schema.columns col
         on col.table_schema=n.nspname and col.table_name=c.relname and col.column_name='user_id'
      where n.nspname='public' and c.relkind='r'
      order by c.relname`,
  )).rows;
  const missingDirect = direct
    .filter((row) => !bootstrapExclusions.has(row.relname) && (!row.relrowsecurity || !row.policy_ready))
    .map((row) => row.relname);

  const indirect = (await client.query(
    `select c.relname,c.relrowsecurity,
            exists (
              select 1 from pg_policy p
               where p.polrelid=c.oid
                 and p.polroles @> array[(select oid from pg_roles where rolname='investogenie_web')]
            ) policy_ready
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1::text[])`,
    [requiredIndirectTables],
  )).rows;
  const indirectByName = new Map(indirect.map((row) => [row.relname, row]));
  const missingIndirect = requiredIndirectTables.filter((name) => {
    const row = indirectByName.get(name);
    return !row?.relrowsecurity || !row?.policy_ready;
  });

  if (missingDirect.length || missingIndirect.length) {
    throw new Error(`RLS coverage gaps: ${[...missingDirect, ...missingIndirect].join(", ")}`);
  }

  await client.query("begin");
  await client.query("set local role investogenie_web");
  const effective = (await client.query(
    `select current_user,
            current_setting('investogenie.user_id',true) tenant,
            current_setting('investogenie.worker',true) worker`,
  )).rows[0];
  await client.query("rollback");
  if (effective.current_user !== "investogenie_web" || effective.tenant || effective.worker) {
    throw new Error(`Restricted role/context smoke test failed: ${JSON.stringify(effective)}`);
  }

  console.log(`RLS audit passed: ${direct.length - bootstrapExclusions.size} direct tenant tables + ${requiredIndirectTables.length} indirect/shared-policy tables.`);
  console.log(`Bootstrap exclusions: ${[...bootstrapExclusions].join(", ")} (opaque-token authentication boundary).`);
} catch (error) {
  console.error("RLS audit failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
