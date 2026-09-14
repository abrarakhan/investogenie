import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  BREEZE_CONNECT_COOKIE,
  BREEZE_CONNECT_MAX_AGE,
  buildBreezeLoginUrl,
  createBreezeConnectState,
  getBreezeApiKey,
} from "@/lib/breeze/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const apiKey = await getBreezeApiKey(user.id);
  if (!apiKey) {
    return NextResponse.redirect(new URL("/settings?market=in&breeze=not_configured", request.url));
  }

  const state = await createBreezeConnectState(user.id);
  const response = NextResponse.redirect(buildBreezeLoginUrl(apiKey));
  response.cookies.set(BREEZE_CONNECT_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // ICICI returns API sessions using a cross-site form POST. Lax cookies are
    // withheld on that request, which makes an otherwise valid callback lose
    // its signed user state and appear expired.
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
    maxAge: BREEZE_CONNECT_MAX_AGE,
  });
  return response;
}
