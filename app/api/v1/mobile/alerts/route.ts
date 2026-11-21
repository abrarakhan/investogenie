import { type NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getMobileSessionUser } from "@/lib/mobileAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AlertPreferences {
  executionReady: boolean;
  midwaySetups: boolean;
  ledgerRiskAlerts: boolean;
  newsHighImpact: boolean;
  quietHoursEnabled: boolean;
  updatedAt: string | null;
}

const DEFAULTS: AlertPreferences = {
  executionReady: true,
  midwaySetups: true,
  ledgerRiskAlerts: true,
  newsHighImpact: false,
  quietHoursEnabled: false,
  updatedAt: null,
};

interface PrefRow {
  execution_ready: boolean;
  midway_setups: boolean;
  ledger_risk_alerts: boolean;
  news_high_impact: boolean;
  quiet_hours_enabled: boolean;
  updated_at: Date | string | null;
}

function toDto(row: PrefRow | undefined): AlertPreferences {
  if (!row) return DEFAULTS;
  return {
    executionReady: Boolean(row.execution_ready),
    midwaySetups: Boolean(row.midway_setups),
    ledgerRiskAlerts: Boolean(row.ledger_risk_alerts),
    newsHighImpact: Boolean(row.news_high_impact),
    quietHoursEnabled: Boolean(row.quiet_hours_enabled),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const rows = await query<PrefRow>(
      `select execution_ready, midway_setups, ledger_risk_alerts, news_high_impact,
              quiet_hours_enabled, updated_at
         from public.mobile_alert_preferences
        where user_id = $1`,
      [user.id],
    );
    return NextResponse.json({ preferences: toDto(rows[0]) });
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    if (code === "42P01") return NextResponse.json({ preferences: DEFAULTS });
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

  const existing = await query<PrefRow>(
    `select execution_ready, midway_setups, ledger_risk_alerts, news_high_impact,
            quiet_hours_enabled, updated_at
       from public.mobile_alert_preferences
      where user_id = $1`,
    [user.id],
  ).catch(() => [] as PrefRow[]);
  const current = toDto(existing[0]);

  const next = {
    executionReady: bool("executionReady", current.executionReady),
    midwaySetups: bool("midwaySetups", current.midwaySetups),
    ledgerRiskAlerts: bool("ledgerRiskAlerts", current.ledgerRiskAlerts),
    newsHighImpact: bool("newsHighImpact", current.newsHighImpact),
    quietHoursEnabled: bool("quietHoursEnabled", current.quietHoursEnabled),
  };

  const rows = await query<PrefRow>(
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
  return NextResponse.json({ preferences: toDto(rows[0]) });
}
