import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EventRow {
  id: string; title: string; body: string; route: string; signature: string; created_at: string;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rawAfter = request.nextUrl.searchParams.get("after");
  if (rawAfter === null) {
    const latest = await queryOne<{ id: string }>(
      `select id::text from public.browser_notification_events where user_id=$1 order by id desc limit 1`,
      [user.id],
    );
    return NextResponse.json({ cursor: latest?.id ?? "0", events: [] });
  }
  if (!/^\d+$/.test(rawAfter)) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  const rows = await query<EventRow>(
    `select id::text,title,body,route,signature,created_at::text
       from public.browser_notification_events
      where user_id=$1 and id>$2::bigint order by id asc limit 50`,
    [user.id, rawAfter],
  );
  return NextResponse.json({ cursor: rows.at(-1)?.id ?? rawAfter, events: rows });
}

