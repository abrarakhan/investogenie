import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// Typeahead search over the catalog, latest price embedded. Ticker-prefix match
// (uppercase) so the btree index is used. India is NSE-only (drop BSE dups).
interface Row {
  id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  country: string;
  asset_class: string;
  currency: string;
  price: string | number | null;
  change_pct: string | number | null;
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const raw = (params.get("q") ?? "").trim();
  const country = params.get("country"); // 'US' | 'IN' | null
  if (raw.length < 1) return NextResponse.json({ results: [] });
  const q = raw.toUpperCase().replace(/[%_,]/g, "");

  const conds = ["a.ticker like $1"];
  const args: unknown[] = [`${q}%`];
  if (country === "US" || country === "IN") {
    args.push(country);
    conds.push(`a.country = $${args.length}`);
  }
  if (country === "IN") conds.push("a.exchange = 'NSE'"); // NSE-only for India

  let rows: Row[] = [];
  try {
    rows = await query<Row>(
      `select a.id, a.ticker, a.name, a.exchange, a.country, a.asset_class, a.currency,
              q.price, q.change_pct
         from public.assets a
         left join public.latest_quotes q on q.asset_id = a.id
        where ${conds.join(" and ")}
        order by a.ticker asc
        limit 20`,
      args,
    );
  } catch (err) {
    return NextResponse.json({ results: [], error: err instanceof Error ? err.message : "error" });
  }

  const results = rows.map((a) => ({
    id: a.id,
    ticker: a.ticker,
    name: a.name,
    exchange: a.exchange,
    country: a.country,
    assetClass: a.asset_class,
    currency: a.currency,
    price: a.price === null ? null : Number(a.price),
    changePct: a.change_pct === null ? null : Number(a.change_pct),
  }));

  return NextResponse.json({ results });
}
