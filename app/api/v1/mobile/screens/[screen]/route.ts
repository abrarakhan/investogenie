import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { normalizeMarket } from "@/lib/markets";
import { loadMobileScreen } from "@/lib/mobileScreens";
import { mobileJson, paginateMobileItems } from "@/lib/mobileHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ screen: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const market = normalizeMarket(params.get("market") ?? "IN");
  if (!market) return NextResponse.json({ error: "market must be IN or US" }, { status: 400 });
  const screen = loadMobileScreen((await context.params).screen, market, params, user.id);
  if (!screen) return NextResponse.json({ error: "Unknown screen" }, { status: 404 });
  const full = await screen;
  const { items: cards, pagination } = paginateMobileItems(
    full.cards,
    params.get("cursor"),
    params.get("limit"),
  );
  const payload = {
    ...full,
    cards,
    pagination,
  };
  // generatedAt describes response assembly, not a data change. Excluding it lets a
  // five-minute mobile poll receive 304 when the cards and controls are unchanged.
  return mobileJson(request, payload, { ...payload, generatedAt: null });
}
