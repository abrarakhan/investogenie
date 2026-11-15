#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { changedFiles } from "./changed-files.mjs";
import { modulesForFiles } from "./module-registry.mjs";

const base = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7);
const modules = modulesForFiles(changedFiles(base));
const commands = [...new Set(modules.flatMap((entry) => entry.tests))];
if (!commands.length) {
  console.log("No targeted checks are registered for the changed files.");
  process.exit(0);
}
console.log(`Running ${commands.length} targeted check(s) for: ${modules.map((entry) => entry.key).join(", ")}`);
for (const command of commands) {
  console.log(`\n$ ${command}`);
  const result = spawnSync(command, { shell: true, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
