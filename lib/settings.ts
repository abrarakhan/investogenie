import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RISK, type RiskConfig } from "@/lib/analytics/swingClassifier";

export interface SwingSettings extends RiskConfig {
  includeShort: boolean;
}

export const DEFAULT_SETTINGS: SwingSettings = { ...DEFAULT_RISK, includeShort: true };

/** Resolve the signed-in user's risk settings, falling back to defaults. */
export async function getUserSwingSettings(
  supabase: SupabaseClient,
): Promise<SwingSettings> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DEFAULT_SETTINGS;
  const { data } = await supabase
    .from("user_swing_settings")
    .select("stop_atr_mult,target_rr,trail_atr_mult,include_short")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    stopAtrMult: Number(data.stop_atr_mult),
    targetRR: Number(data.target_rr),
    trailAtrMult: Number(data.trail_atr_mult),
    includeShort: Boolean(data.include_short),
  };
}
