import "server-only";
import { tenantQuery } from "@/lib/db";

export interface MobileAlertPreferences {
  executionReady: boolean;
  midwaySetups: boolean;
  ledgerRiskAlerts: boolean;
  newsHighImpact: boolean;
  quietHoursEnabled: boolean;
  updatedAt: string | null;
}

export const DEFAULT_MOBILE_ALERT_PREFERENCES: MobileAlertPreferences = {
  executionReady: true,
  midwaySetups: true,
  ledgerRiskAlerts: true,
  newsHighImpact: false,
  quietHoursEnabled: false,
  updatedAt: null,
};

export interface MobileAlertPreferenceRow {
  execution_ready: boolean;
  midway_setups: boolean;
  ledger_risk_alerts: boolean;
  news_high_impact: boolean;
  quiet_hours_enabled: boolean;
  updated_at: Date | string | null;
}

export function mobileAlertPreferencesDto(row: MobileAlertPreferenceRow | undefined): MobileAlertPreferences {
  if (!row) return DEFAULT_MOBILE_ALERT_PREFERENCES;
  return {
    executionReady: Boolean(row.execution_ready),
    midwaySetups: Boolean(row.midway_setups),
    ledgerRiskAlerts: Boolean(row.ledger_risk_alerts),
    newsHighImpact: Boolean(row.news_high_impact),
    quietHoursEnabled: Boolean(row.quiet_hours_enabled),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function getMobileAlertPreferences(userId: string): Promise<MobileAlertPreferences> {
  try {
    const rows = await tenantQuery<MobileAlertPreferenceRow>(userId,
      `select execution_ready, midway_setups, ledger_risk_alerts, news_high_impact,
              quiet_hours_enabled, updated_at
         from public.mobile_alert_preferences
        where user_id = $1`,
      [userId],
    );
    return mobileAlertPreferencesDto(rows[0]);
  } catch (cause) {
    // During a rolling deploy the API may start before migration 0088 is visible.
    // Defaults preserve the pre-preference delivery behaviour without mixing users.
    if ((cause as { code?: string })?.code === "42P01") return DEFAULT_MOBILE_ALERT_PREFERENCES;
    throw cause;
  }
}
