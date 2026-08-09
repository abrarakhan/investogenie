import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";

const root = process.cwd();
process.loadEnvFile(resolve(root, ".env.local"));

const email = (process.env.INVESTOGENIE_RESET_EMAIL ?? "").trim().toLowerCase();
const password = process.env.INVESTOGENIE_RESET_PASSWORD ?? "";
const databaseUrl = process.env.DATABASE_URL;

if (!email || !email.includes("@")) {
  console.error("A valid account email is required.");
  process.exit(2);
}

if (password.length < 6) {
  console.error("The new password must be at least 6 characters.");
  process.exit(2);
}

if (!databaseUrl) {
  console.error("DATABASE_URL is missing from .env.local.");
  process.exit(2);
}

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await client.query(
    `update public.users
        set password_hash = $2
      where lower(email) = lower($1)
      returning email`,
    [email, passwordHash],
  );

  if (result.rowCount !== 1) {
    console.error(`No InvestoGenie account exists for ${email}.`);
    process.exitCode = 1;
  } else {
    console.log(`Password reset for ${result.rows[0].email}.`);
  }
} finally {
  await client.end().catch(() => undefined);
}
