import { type NextRequest, NextResponse } from "next/server";

// Email-OTP confirmation is no longer used — signup creates a session directly
// (see app/login/actions.ts). This route remains only to keep old links from
// 404ing; it just sends the user to the login page.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/login", request.url));
}
