import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EventRow {
  id: string; title: string; body: string; route: string; signature: string; created_at: string;
  deliverable: boolean;
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
    `select e.id::text,e.title,e.body,e.route,e.signature,e.created_at::text,
            case when e.kind<>'CANDIDATE_READY' then true else exists (
              select 1 from public.mobile_candidate_alert_state s
               where s.user_id=e.user_id and s.market=e.market and s.asset_id=e.asset_id
                 and s.was_ready=true
                 and concat(s.engine,'|',s.asset_id::text,'|',s.last_status)=e.signature
            ) end deliverable
       from public.browser_notification_events e
      where e.user_id=$1 and e.id>$2::bigint order by e.id asc limit 50`,
    [user.id, rawAfter],
  );
  return NextResponse.json({
    cursor: rows.at(-1)?.id ?? rawAfter,
    events: rows.filter((row) => row.deliverable).map((row) => ({
      id: row.id, title: row.title, body: row.body, route: row.route,
      signature: row.signature, created_at: row.created_at,
    })),
  });
}

