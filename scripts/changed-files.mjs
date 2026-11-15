import { execFileSync } from "node:child_process";

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function changedFiles(baseArg) {
  const base = baseArg || process.env.MODULE_BASE_REF || "HEAD~1";
  const committed = git(["diff", "--name-only", `${base}...HEAD`]);
  const working = git(["diff", "--name-only", "HEAD"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([committed, working, untracked]
    .flatMap((text) => text ? text.split("\n") : [])
    .map((file) => file.trim()).filter(Boolean))].sort();
}
