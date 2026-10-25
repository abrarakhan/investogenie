import { type NextRequest, NextResponse } from "next/server";
import { runTechnicalBacktest } from "@/lib/screener/backtest";
import type { Filter } from "@/lib/screener/filterEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { market?: string; universe?: string; filters?: Filter[]; years?: number };
    const result = await runTechnicalBacktest({
      market: body.market === "US" ? "US" : "IN",
      universe: body.universe,
      filters: Array.isArray(body.filters) ? body.filters : [],
      years: Number(body.years ?? 3),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
