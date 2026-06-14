import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

// Typeahead search over the 17k-instrument catalog, with the latest price
// embedded. Ticker-prefix match (uppercase) so the btree index is used.
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const raw = (params.get("q") ?? "").trim();
  const country = params.get("country"); // 'US' | 'IN' | null
  if (raw.length < 1) return NextResponse.json({ results: [] });
  const q = raw.toUpperCase().replace(/[%_,]/g, "");

  const supabase = createClient(await cookies());
  let query = supabase
    .from("assets")
    .select(
      "id,ticker,name,exchange,country,asset_class,currency, latest_quotes(price,change_pct)",
    )
    .like("ticker", `${q}%`);
  if (country === "US" || country === "IN") query = query.eq("country", country);
  const { data, error } = await query
    .order("ticker", { ascending: true })
    .limit(20);

  if (error) return NextResponse.json({ results: [], error: error.message });

  const results = (data ?? []).map((a: Record<string, unknown>) => {
    const lq = a.latest_quotes as { price: number; change_pct: number | null } | { price: number; change_pct: number | null }[] | null;
    const quote = Array.isArray(lq) ? lq[0] : lq;
    return {
      id: a.id as string,
      ticker: a.ticker as string,
      name: a.name as string | null,
      exchange: a.exchange as string | null,
      country: a.country as string,
      assetClass: a.asset_class as string,
      currency: a.currency as string,
      price: quote ? Number(quote.price) : null,
      changePct: quote && quote.change_pct !== null ? Number(quote.change_pct) : null,
    };
  });

  return NextResponse.json({ results });
}
