import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deploymentEnvErrors } from "./deploy-env-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("deployment authorization preflight", () => {
  it("requires the owner email and the nginx-overwritten proxy header", () => {
    expect(deploymentEnvErrors({ DEFAULT_USER_EMAIL: "owner@example.test", TRUSTED_PROXY_IP_HEADER: "X-Real-IP" })).toEqual([]);
    expect(deploymentEnvErrors({ TRUSTED_PROXY_IP_HEADER: "x-real-ip" })).toHaveLength(1);
    expect(deploymentEnvErrors({ DEFAULT_USER_EMAIL: "owner@example.test" })[0]).toMatch(/TRUSTED_PROXY_IP_HEADER is not set/);
    expect(deploymentEnvErrors({ DEFAULT_USER_EMAIL: "o@x.test", TRUSTED_PROXY_IP_HEADER: "x-forwarded-for" })[0]).toMatch(/must be x-real-ip/);
    expect(deploymentEnvErrors({ DEFAULT_USER_EMAIL: "o@x.test", TRUSTED_PROXY_IP_HEADER: "x-real-ip", ALLOW_OPEN_SIGNUP: "true" })[0]).toMatch(/obsolete/);
  });

  it("runs before build and migrations, and owner bootstrap runs before any restart", () => {
    const release = readFileSync(`${root}/deploy/oracle/deploy-release.sh`, "utf8");
    const at = (needle: string) => {
      const index = release.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    expect(at("node scripts/check-deploy-env.mjs")).toBeGreaterThan(at("INVESTOGENIE_DEPLOY_REEXEC=1 bash"));
    expect(at("node scripts/check-deploy-env.mjs")).toBeLessThan(at("npm ci --include=dev"));
    expect(at("node scripts/bootstrap-admin.mjs")).toBeGreaterThan(at("node scripts/apply-production-migrations.mjs"));
    expect(at("node scripts/bootstrap-admin.mjs")).toBeLessThan(at("systemctl restart investogenie"));
  });

  it("matches the header the nginx template overwrites", () => {
    expect(readFileSync(`${root}/deploy/oracle/nginx.conf.template`, "utf8")).toMatch(/proxy_set_header X-Real-IP \$remote_addr;/);
  });
});
