import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("production deployment lifecycle", () => {
  it("installs deterministically without a lockfile-mutating prune step", () => {
    const release = readFileSync(`${root}/deploy/lightsail/deploy-release.sh`, "utf8");
    expect(release).toContain("npm ci --include=dev");
    expect(release).not.toMatch(/&& npm prune/);
    expect(release).toContain("git -C \"${APP_DIR}\" restore --worktree -- package-lock.json");
    expect(release).toContain("refusing to deploy");
  });

  it("releases database readers before migrations and restores services on failure", () => {
    const release = readFileSync(`${root}/deploy/lightsail/deploy-release.sh`, "utf8");
    const stop = release.indexOf("systemctl stop investogenie.service investogenie-breeze.service");
    const migrate = release.indexOf("node scripts/apply-production-migrations.mjs");
    const restart = release.indexOf("systemctl restart investogenie");
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(restart);
    expect(release).toContain("trap restore_services EXIT");
    expect(release).toContain("trap - EXIT");
  });

  it("terminates every long-running child and exits after Next.js closes", () => {
    const wrapper = readFileSync(`${root}/scripts/run-with-nse-sync.mjs`, "utf8");
    for (const child of [
      "usLiveQuoteChild",
      "breezeAutoBuyChild",
      "corporateResultsChild",
      "mlSnapshotChild",
    ]) {
      expect(wrapper).toContain(`if (${child}) ${child}.kill(signal);`);
      expect(wrapper).toContain(`if (${child}) ${child}.kill(\"SIGTERM\");`);
    }
    expect(wrapper).toMatch(/nextChild\.on\("close",[\s\S]*process\.exit\(/);
  });
});
