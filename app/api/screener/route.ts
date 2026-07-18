import { type NextRequest, NextResponse } from "next/server";
import { getScreenerResults, type Market } from "@/lib/screener/service";
import type { Filter, SortSpec } from "@/lib/screener/filterEngine";

// Server-side screener query: filter + sort + paginate over stock_snapshot.
// POST so complex filter arrays travel in the body rather than the URL.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  market?: string;
  universe?: string;
  filters?: Filter[];
  sort?: SortSpec;
  search?: string;
  page?: number;
  pageSize?: number;
  valueBelowSectorMedian?: boolean;
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const market: Market = body.market === "US" ? "US" : "IN";
  try {
    const result = await getScreenerResults({
      market,
      universe: body.universe,
      filters: Array.isArray(body.filters) ? body.filters : [],
      sort: body.sort,
      search: body.search,
      page: body.page,
      pageSize: body.pageSize,
      valueBelowSectorMedian: body.valueBelowSectorMedian,
    });
    return NextResponse.json(result);
  } catch (err) {
    // Filter validation failures are user errors (bad field/op/value) -> 400.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
