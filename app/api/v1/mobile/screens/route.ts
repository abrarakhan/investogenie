import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { MOBILE_SCREEN_CATALOG } from "@/lib/mobileScreens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The tab list for the Android and iOS apps, in display order. */
export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ screens: MOBILE_SCREEN_CATALOG });
}
