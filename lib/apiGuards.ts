import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { checkRateLimit, type RateLimitRule } from "@/lib/rateLimit";

type Guarded = { user: SessionUser; response?: never } | { user?: never; response: NextResponse };

/**
 * Route-handler guard: a signed-in web user, rate limited per user ID for
 * each named bucket. Returns either the user or the error response to send.
 */
export async function requireApiUser(...limits: Array<[bucket: string, rule: RateLimitRule]>): Promise<Guarded> {
  const user = await getSessionUser();
  if (!user) return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  for (const [bucket, rule] of limits) {
    const result = checkRateLimit(`${bucket}:user:${user.id}`, rule);
    if (!result.ok) {
      return {
        response: NextResponse.json(
          { error: "Too many requests; try again shortly." },
          { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
        ),
      };
    }
  }
  return { user };
}
