// Pure validation of deployment settings required by authorization. Kept
// separate from the CLI so it can be unit tested without a database.

/** nginx in deploy/oracle overwrites X-Real-IP with $remote_addr. */
export const EXPECTED_PROXY_IP_HEADER = "x-real-ip";

export function deploymentEnvErrors(env) {
  const errors = [];
  if (!env.DEFAULT_USER_EMAIL?.trim()) {
    errors.push("DEFAULT_USER_EMAIL is not set: it names the account made ADMIN and system owner.");
  }
  const header = env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();
  if (!header) {
    errors.push(`TRUSTED_PROXY_IP_HEADER is not set: per-IP sign-in throttling would be off (expected ${EXPECTED_PROXY_IP_HEADER}).`);
  } else if (header !== EXPECTED_PROXY_IP_HEADER) {
    errors.push(`TRUSTED_PROXY_IP_HEADER must be ${EXPECTED_PROXY_IP_HEADER} (the header nginx overwrites), not ${header}.`);
  }
  if (env.ALLOW_OPEN_SIGNUP) {
    errors.push("ALLOW_OPEN_SIGNUP is obsolete: sign-up is invitation-only. Remove it.");
  }
  return errors;
}
