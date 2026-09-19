import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getMobileSession } from "@/lib/mobileAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validToken = (value: unknown): value is string =>
  typeof value === "string" && /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(value);

export async function POST(request: NextRequest) {
  const session = await getMobileSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { token?: unknown; platform?: unknown } | null;
  if (!validToken(body?.token) || (body?.platform !== "android" && body?.platform !== "ios")) {
    return NextResponse.json({ error: "A valid Expo push token and platform are required" }, { status: 400 });
  }
  await query(
    `insert into public.mobile_push_tokens(user_id,mobile_session_id,expo_push_token,platform)
     values($1,$2,$3,$4)
     on conflict(expo_push_token) do update set user_id=excluded.user_id,
       mobile_session_id=excluded.mobile_session_id,platform=excluded.platform,
       enabled=true,updated_at=now(),last_seen_at=now()`,
    [session.user.id, session.sessionId, body.token, body.platform],
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getMobileSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await query(`update public.mobile_push_tokens set enabled=false,updated_at=now() where user_id=$1 and mobile_session_id=$2`, [session.user.id, session.sessionId]);
  return new NextResponse(null, { status: 204 });
}
