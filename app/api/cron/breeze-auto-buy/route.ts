import { type NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/ingest/cronLog";
import { query } from "@/lib/db";
import { getUserSwingSettings } from "@/lib/settings";
import { getStrongSwingCandidates, type StrongSwingCandidate } from "@/features/strong-swing/service";
import { seedStrongSwing, swingSettingsKey } from "@/lib/displayScanCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  const users = await query<{ user_id: string }>(
    "select user_id from public.breeze_auto_buy_settings where enabled and strong_swing_enabled",
  );
  const bySettings = new Map<string, StrongSwingCandidate[]>();
  let candidates = 0;
  for (const { user_id } of users) {
    const settings = await getUserSwingSettings(user_id);
    const key = swingSettingsKey(settings);
    let list = bySettings.get(key);
    if (!list) {
      list = await getStrongSwingCandidates("IN", settings);
      seedStrongSwing("IN", settings, list);
      bySettings.set(key, list);
    }
    candidates += list.filter((item) => item.status === "EXECUTION_READY").length;
  }
  return NextResponse.json({ ok: true, users: users.length, executionReady: candidates });
}
