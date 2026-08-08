import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";

const target = process.argv[2] ?? "local";
if (!new Set(["local", "oracle"]).has(target)) {
  console.error("Usage: node scripts/check-deployment.mjs <local|oracle>");
  process.exit(2);
}

if (target === "local" && existsSync(".env.local")) process.loadEnvFile(".env.local");

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const major = Number(process.versions.node.split(".")[0]);
check("Node.js", major >= 20, `${process.version} (requires 20+)`);

const python = process.env.PYTHON_BIN || ".venv/bin/python";
const py = spawnSync(python, ["--version"], { encoding: "utf8" });
check("Python environment", py.status === 0, (py.stdout || py.stderr || python).trim());
check("Python requirements", existsSync("pipelines/requirements.txt"), "pipelines/requirements.txt");

const required = ["DATABASE_URL", "SESSION_SECRET", "CRON_SECRET", "CREDENTIAL_ENCRYPTION_KEY"];
for (const name of required) {
  const value = process.env[name];
  check(name, value && !/REPLACE|change-me/i.test(value), value ? "configured" : "missing");
}

if (target === "local") {
  check("Local environment file", existsSync(".env.local"), ".env.local");
  check(
    "Local database address",
    /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? ""),
    "local PostgreSQL only",
  );
} else {
  check("Production mode", process.env.NODE_ENV === "production", `NODE_ENV=${process.env.NODE_ENV ?? "missing"}`);
  check("Production build", existsSync(".next/BUILD_ID"), ".next/BUILD_ID");
  check(
    "Private PostgreSQL",
    /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? ""),
    "PostgreSQL should stay on the VM loopback interface",
  );
  check(
    "Public HTTPS URL",
    /^https:\/\//.test(process.env.NEXT_PUBLIC_APP_URL ?? ""),
    process.env.NEXT_PUBLIC_APP_URL ?? "missing",
  );
}

if (process.env.DATABASE_URL) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const result = await client.query(`
      select current_database() database,
             pg_size_pretty(pg_database_size(current_database())) size,
             to_regclass('public.users') is not null users_ready,
             to_regclass('public.daily_ohlcv') is not null market_data_ready
    `);
    const row = result.rows[0];
    check("PostgreSQL connection", row.users_ready && row.market_data_ready, `${row.database}, ${row.size}`);
  } catch (error) {
    check("PostgreSQL connection", false, error instanceof Error ? error.message : String(error));
  } finally {
    await client.end().catch(() => {});
  }
}

for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`);
}
const failures = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failures.length}/${checks.length} deployment checks passed for ${target}.`);
if (failures.length) process.exit(1);
