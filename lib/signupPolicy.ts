/**
 * Public self-service sign-up is closed by default. Anyone who can reach the
 * login page could otherwise become an authenticated user. ALLOW_OPEN_SIGNUP
 * is a temporary escape hatch until invitation-based sign-up replaces it.
 */
export function isOpenSignupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALLOW_OPEN_SIGNUP === "true";
}

export const SIGNUP_CLOSED_MESSAGE = "Sign-up is closed. Ask the owner for an invitation.";
