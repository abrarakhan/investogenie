import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Run an ESM snippet under plain `node` with the alias hook, as the scheduler's child jobs do. */
function runWithHook(source: string) {
  return spawnSync(process.execPath, ["--import", "./scripts/ts-alias-hook.mjs", "--input-type=module", "-e", source], {
    cwd: root, encoding: "utf8", timeout: 60_000,
  });
}

describe("ts-alias-hook", () => {
  it("resolves extensionless package subpaths such as next/headers", () => {
    const result = runWithHook(`const m = await import("next/headers"); console.log(typeof m.cookies);`);
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(result.stdout.trim()).toBe("function");
  });

  // The ML snapshot job imports lib/settings, which reaches next/headers through lib/auth.
  it("loads lib/settings outside Next.js", () => {
    const result = runWithHook(`const m = await import("@/lib/settings"); console.log(typeof m.DEFAULT_SETTINGS.targetRR);`);
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(result.stdout.trim()).toBe("number");
  });

  it("still reports packages that do not exist", () => {
    const result = runWithHook(`await import("definitely-not-installed/subpath");`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ERR_MODULE_NOT_FOUND/);
  });
});
