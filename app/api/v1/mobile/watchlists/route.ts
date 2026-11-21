import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { runIdempotentMobileMutation } from "@/lib/mobileMutationResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WatchlistRow {
  id: string;
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string;
  price: string | null;
  change_pct: string | null;
  as_of: string | Date | null;
}

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const market = normalizeMarket(request.nextUrl.searchParams.get("market") ?? "IN");
  if (!market) return NextResponse.json({ error: "market must be IN or US" }, { status: 400 });

  const rows = await query<WatchlistRow>(
    `select w.id, w.asset_id, a.ticker, a.name, a.exchange,
            q.price::text, q.change_pct::text, q.as_of
       from public.watchlist_items w
       join public.assets a on a.id = w.asset_id
       left join public.latest_quotes q on q.asset_id = a.id
      where w.user_id = $1 and a.country = $2
      order by w.created_at desc`,
    [user.id, market],
  );
  return NextResponse.json({
    market,
    items: rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      price: row.price === null ? null : Number(row.price),
      changePct: row.change_pct === null ? null : Number(row.change_pct),
      asOf: row.as_of instanceof Date ? row.as_of.toISOString().slice(0, 10) : row.as_of,
    })),
  });
}

export async function POST(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { market?: unknown; ticker?: unknown } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const market = normalizeMarket(typeof body.market === "string" ? body.market : "IN");
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!market || !ticker || !/^[A-Z0-9.&_-]{1,20}$/.test(ticker)) {
    return NextResponse.json({ error: "A valid market and ticker are required" }, { status: 400 });
  }

  return runIdempotentMobileMutation(request, user.id, "WATCHLIST_ADD", { market, ticker }, async () => {
    const primaryExchange = market === "IN" ? "NSE" : "NASDAQ";
    const assets = await query<{ id: string }>(
      `select id from public.assets
        where country = $1 and upper(ticker) = $2 and is_active
        order by case when exchange = $3 then 0 else 1 end, created_at
        limit 1`,
      [market, ticker, primaryExchange],
    );
    if (!assets[0]) {
      return { status: 404, body: { error: `${ticker} was not found in ${market}` } };
    }
    const existingList = await query<{ id: string }>(
      `select id from public.watchlists where user_id = $1 order by created_at asc limit 1`,
      [user.id],
    );
    let watchlistId = existingList[0]?.id;
    if (!watchlistId) {
      const created = await query<{ id: string }>(
        `insert into public.watchlists (user_id, name) values ($1, 'My Watchlist') returning id`,
        [user.id],
      );
      watchlistId = created[0].id;
    }
    const inserted = await query<{ id: string }>(
      `insert into public.watchlist_items (user_id, watchlist_id, asset_id)
       values ($1, $2, $3)
       on conflict (watchlist_id, asset_id) do update set user_id = excluded.user_id
       returning id`,
      [user.id, watchlistId, assets[0].id],
    );
    return { status: 201, body: { ok: true, id: inserted[0]?.id ?? null } };
  });
}

export async function DELETE(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (request.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Valid watchlist item id is required" }, { status: 400 });
  }
  return runIdempotentMobileMutation(request, user.id, "WATCHLIST_DELETE", { id }, async () => {
    await query("delete from public.watchlist_items where id = $1 and user_id = $2", [id, user.id]);
    return { status: 200, body: { ok: true } };
  });
}
