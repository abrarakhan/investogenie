import { DEFAULT_RISK, type RiskConfig } from "@/lib/analytics/swingClassifier";
import { getSessionUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export interface SwingSettings extends RiskConfig {
  includeShort: boolean;
}

export const DEFAULT_SETTINGS: SwingSettings = { ...DEFAULT_RISK, includeShort: true };

interface Row {
  stop_atr_mult: string | number;
  target_rr: string | number;
  trail_atr_mult: string | number;
  include_short: boolean;
}

/** Resolve the signed-in user's risk settings, falling back to defaults. */
export async function getUserSwingSettings(): Promise<SwingSettings> {
  const user = await getSessionUser();
  if (!user) return DEFAULT_SETTINGS;
  const data = await queryOne<Row>(
    "select stop_atr_mult, target_rr, trail_atr_mult, include_short from public.user_swing_settings where user_id = $1",
    [user.id],
  );
  if (!data) return DEFAULT_SETTINGS;
  return {
    stopAtrMult: Number(data.stop_atr_mult),
    targetRR: Number(data.target_rr),
    trailAtrMult: Number(data.trail_atr_mult),
    includeShort: Boolean(data.include_short),
  };
}
