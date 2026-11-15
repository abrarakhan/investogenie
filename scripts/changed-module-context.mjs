#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { changedFiles } from "./changed-files.mjs";
import { modulesForFiles } from "./module-registry.mjs";

const base = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7);
const files = changedFiles(base);
const modules = modulesForFiles(files);

console.log(`Changed files (${files.length}):`);
for (const file of files) console.log(`  ${file}`);
if (!modules.length) {
  console.log("\nNo registered feature module matched. Read AGENTS.md and inspect only the changed files.");
  process.exit(0);
}
for (const entry of modules) {
  console.log(`\n=== ${entry.key} ===`);
  console.log(`Guide: ${entry.guide}`);
  console.log(`Dependencies: ${entry.dependencies.join(", ") || "none"}`);
  console.log("Targeted checks:");
  for (const command of entry.tests) console.log(`  ${command}`);
  console.log("Guide summary:");
  for (const line of readFileSync(entry.guide, "utf8").split("\n").filter((line) => line.startsWith("- "))) {
    console.log(`  ${line.slice(2)}`);
  }
}
