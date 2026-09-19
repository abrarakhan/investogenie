import { type NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { normalizeMarket } from "@/lib/markets";
import { getNewsSwingWorkspace } from "@/lib/newsSwing";
import { getUserSwingSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const market = normalizeMarket(request.nextUrl.searchParams.get("market") ?? "IN");
  if (!market) return NextResponse.json({ error: "market must be IN or US" }, { status: 400 });
  const settings = await getUserSwingSettings(user.id);
  const workspace = await getNewsSwingWorkspace(market, settings);
  return NextResponse.json({ market, generatedAt: new Date().toISOString(), ...workspace });
}
