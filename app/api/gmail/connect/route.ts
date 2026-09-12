import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  buildGmailAuthorizationUrl,
  createGmailOAuthState,
  getGmailOAuthConfig,
} from "@/lib/gmail/disclosures";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const config = await getGmailOAuthConfig(user.id);
  if (!config) {
    return NextResponse.redirect(new URL("/portfolio/fund-mapping?gmail=not_configured", request.url));
  }
  // Behind nginx/systemd, Next can see the internal localhost origin even
  // though the browser is on the public HTTPS host. OAuth redirect URIs must
  // exactly match the registered public callback.
  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;
  const redirectUri = new URL("/api/gmail/callback", publicOrigin).toString();
  const state = await createGmailOAuthState(user.id, redirectUri);
  return NextResponse.redirect(buildGmailAuthorizationUrl(config.clientId, redirectUri, state));
}
