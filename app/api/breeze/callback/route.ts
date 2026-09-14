import { NextRequest, NextResponse } from "next/server";
import {
  BREEZE_CONNECT_COOKIE,
  extractBreezeApiSession,
  readBreezeConnectState,
  saveBreezeApiSession,
} from "@/lib/breeze/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settingsRedirect(request: NextRequest, status: string) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const publicOrigin = configuredOrigin
    || (forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : request.nextUrl.origin);
  // ICICI may submit the callback as POST. A 303 ensures the browser follows
  // with a normal GET instead of replaying that POST against the Settings page.
  const response = NextResponse.redirect(
    new URL(`/settings?market=in&breeze=${status}`, `${publicOrigin}/`),
    303,
  );
  response.cookies.delete(BREEZE_CONNECT_COOKIE);
  return response;
}

async function handleCallback(request: NextRequest) {
  const userId = await readBreezeConnectState(
    request.cookies.get(BREEZE_CONNECT_COOKIE)?.value,
  );
  if (!userId) return settingsRedirect(request, "invalid_state");

  const apiSession = extractBreezeApiSession(request.nextUrl.searchParams);
  if (!apiSession) return settingsRedirect(request, "denied");

  try {
    const saved = await saveBreezeApiSession(userId, apiSession);
    return settingsRedirect(request, saved ? "connected" : "not_configured");
  } catch (cause) {
    console.error("Breeze session callback failed", cause instanceof Error ? cause.message : cause);
    return settingsRedirect(request, "failed");
  }
}

export const GET = handleCallback;
export const POST = handleCallback;
