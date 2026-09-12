import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  completeGmailConnection,
  consumeGmailOAuthState,
} from "@/lib/gmail/disclosures";

export const runtime = "nodejs";

function publicUrl(path: string, request: NextRequest) {
  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;
  return new URL(path, publicOrigin);
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(publicUrl("/login", request));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  if (error || !code || !state) {
    return NextResponse.redirect(publicUrl("/portfolio/fund-mapping?gmail=denied", request));
  }
  const redirectUri = await consumeGmailOAuthState(state, user.id);
  if (!redirectUri) {
    return NextResponse.redirect(publicUrl("/portfolio/fund-mapping?gmail=invalid_state", request));
  }
  try {
    await completeGmailConnection({ userId: user.id, code, redirectUri });
    return NextResponse.redirect(publicUrl("/portfolio/fund-mapping?gmail=connected", request));
  } catch (cause) {
    console.error("Gmail OAuth callback failed", cause);
    return NextResponse.redirect(publicUrl("/portfolio/fund-mapping?gmail=failed", request));
  }
}
