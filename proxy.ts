import { NextResponse } from "next/server";

// Sessions are now a self-contained signed cookie (see lib/auth.ts) — there is
// no server-side token to refresh, so the proxy is a simple pass-through. Kept
// as a placeholder in case request-level middleware is needed later.
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
