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
  const redirectUri = new URL("/api/gmail/callback", request.url).toString();
  const state = await createGmailOAuthState(user.id, redirectUri);
  return NextResponse.redirect(buildGmailAuthorizationUrl(config.clientId, redirectUri, state));
}
