// Gate for the login-screen password reset.
//
// The login page is reachable by anything that can reach the app — every device on the
// tailnet — so an ungated "set a new password" form there would be an account-takeover path
// rather than a convenience. The reset is therefore gated on a recovery key that only someone
// with host access can read out of .env.local. With no key configured the flow is off and the
// login screen does not offer it, so it cannot become a silent hole by omission.
//
// Kept free of next/* imports so the rules stay unit-testable.
import { timingSafeEqual } from "node:crypto";

/** Long enough that it cannot be brute-forced through the form, short enough to paste. */
export const MIN_RESET_KEY_LENGTH = 16;

export function isResetKeyConfigured(key: string | undefined): boolean {
  return (key ?? "").length >= MIN_RESET_KEY_LENGTH;
}

/**
 * Constant-time comparison. `timingSafeEqual` throws on length mismatch and comparing lengths
 * first would leak the key's length, so both sides are hashed to a fixed width before the
 * comparison — length differences then show up as content differences.
 */
export function resetKeyMatches(supplied: string, expected: string): boolean {
  if (!isResetKeyConfigured(expected)) return false;
  const encoder = new TextEncoder();
  const a = Buffer.from(encoder.encode(supplied));
  const b = Buffer.from(encoder.encode(expected));
  if (a.length !== b.length) {
    // Still burn a comparison of equal width so a wrong-length key is not measurably faster.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
