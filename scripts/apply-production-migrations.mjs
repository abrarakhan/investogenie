#!/usr/bin/env node

// Apply the production-era migrations in numeric order. Keeping discovery in
// one place prevents a newly committed migration from being silently skipped
// because the deploy shell script ended at the previous migration number.
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const directory = resolve(root, "db/migrations");
const files = (await readdir(directory))
  .map((name) => ({ name, match: name.match(/^(\d{4})_.+\.sql$/) }))
  .filter(({ match }) => match && Number(match[1]) >= 33)
  .sort((left, right) => left.name.localeCompare(right.name));

for (const { name } of files) {
  const migration = `db/migrations/${name}`;
  const result = spawnSync(process.execPath, ["scripts/apply-migration.mjs", migration], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

