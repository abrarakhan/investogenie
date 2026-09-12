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
  const response = NextResponse.redirect(new URL(`/settings?market=in&breeze=${status}`, request.url));
  response.cookies.delete(BREEZE_CONNECT_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
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
