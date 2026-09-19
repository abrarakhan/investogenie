import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { getStrongSwingCandidates } from "@/lib/strongSwing";
import { getUserSwingSettings } from "@/lib/settings";
import { normalizeMarket } from "@/lib/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const market = normalizeMarket(request.nextUrl.searchParams.get("market") ?? "IN");
  if (!market) return NextResponse.json({ error: "market must be IN or US" }, { status: 400 });
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.trunc(requestedLimit))) : 30;
  const settings = await getUserSwingSettings(user.id);
  const candidates = (await getStrongSwingCandidates(market, settings)).slice(0, limit);
  return NextResponse.json({ market, generatedAt: new Date().toISOString(), candidates });
}

