import { type NextRequest, NextResponse } from "next/server";
import { tenantQuery } from "@/lib/db";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import {
  getMobileAlertPreferences,
  mobileAlertPreferencesDto,
  type MobileAlertPreferences as AlertPreferences,
  type MobileAlertPreferenceRow as PrefRow,
} from "@/lib/mobileAlertPreferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ preferences: await getMobileAlertPreferences(user.id) });
  } catch {
    return NextResponse.json({ error: "Could not load alert preferences" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bool = (key: keyof AlertPreferences, fallback: boolean): boolean =>
    typeof body[key] === "boolean" ? (body[key] as boolean) : fallback;

  const current = await getMobileAlertPreferences(user.id);

  const next = {
    executionReady: bool("executionReady", current.executionReady),
    midwaySetups: bool("midwaySetups", current.midwaySetups),
    ledgerRiskAlerts: bool("ledgerRiskAlerts", current.ledgerRiskAlerts),
    newsHighImpact: bool("newsHighImpact", current.newsHighImpact),
    quietHoursEnabled: bool("quietHoursEnabled", current.quietHoursEnabled),
  };

  const rows = await tenantQuery<PrefRow>(user.id,
    `insert into public.mobile_alert_preferences (
       user_id, execution_ready, midway_setups, ledger_risk_alerts,
       news_high_impact, quiet_hours_enabled, updated_at
     ) values ($1, $2, $3, $4, $5, $6, now())
     on conflict (user_id) do update set
       execution_ready = excluded.execution_ready,
       midway_setups = excluded.midway_setups,
       ledger_risk_alerts = excluded.ledger_risk_alerts,
       news_high_impact = excluded.news_high_impact,
       quiet_hours_enabled = excluded.quiet_hours_enabled,
       updated_at = now()
     returning execution_ready, midway_setups, ledger_risk_alerts,
               news_high_impact, quiet_hours_enabled, updated_at`,
    [
      user.id,
      next.executionReady,
      next.midwaySetups,
      next.ledgerRiskAlerts,
      next.newsHighImpact,
      next.quietHoursEnabled,
    ],
  );
  return NextResponse.json({ preferences: mobileAlertPreferencesDto(rows[0]) });
}
