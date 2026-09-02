import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  completeGmailConnection,
  consumeGmailOAuthState,
} from "@/lib/gmail/disclosures";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  if (error || !code || !state) {
    return NextResponse.redirect(new URL("/portfolio/fund-mapping?gmail=denied", request.url));
  }
  const redirectUri = await consumeGmailOAuthState(state, user.id);
  if (!redirectUri) {
    return NextResponse.redirect(new URL("/portfolio/fund-mapping?gmail=invalid_state", request.url));
  }
  try {
    await completeGmailConnection({ userId: user.id, code, redirectUri });
    return NextResponse.redirect(new URL("/portfolio/fund-mapping?gmail=connected", request.url));
  } catch (cause) {
    console.error("Gmail OAuth callback failed", cause);
    return NextResponse.redirect(new URL("/portfolio/fund-mapping?gmail=failed", request.url));
  }
}
