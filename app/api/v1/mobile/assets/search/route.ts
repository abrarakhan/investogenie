import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { query } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const market = normalizeMarket(request.nextUrl.searchParams.get("market") ?? "IN");
  const raw = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (!market) return NextResponse.json({ error: "market must be IN or US" }, { status: 400 });
  if (!raw) return NextResponse.json({ results: [] });
  const search = raw.toUpperCase().replace(/[%_,]/g, "");
  const rows = await query<Record<string, unknown>>(
    `select a.id,a.ticker,a.name,a.exchange,a.currency,q.price,q.change_pct,q.updated_at
       from public.assets a left join public.latest_quotes q on q.asset_id=a.id
      where a.country=$1 and a.asset_class='STOCK' and a.is_active
        and (upper(a.ticker) like $2 || '%' or upper(coalesce(a.name,'')) like '%' || $2 || '%')
        ${market === "IN" ? "and a.exchange='NSE'" : ""}
      order by case when upper(a.ticker)=$2 then 0 else 1 end,a.ticker limit 20`,
    [market, search],
  );
  return NextResponse.json({ results: rows.map((row) => ({
    id: String(row.id), ticker: String(row.ticker), name: row.name ? String(row.name) : null,
    exchange: row.exchange ? String(row.exchange) : null, currency: String(row.currency),
    price: row.price === null ? null : Number(row.price), changePct: row.change_pct === null ? null : Number(row.change_pct),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ? String(row.updated_at) : null,
  })) });
}
