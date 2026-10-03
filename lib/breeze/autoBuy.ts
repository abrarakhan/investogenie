import { getSessionUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export interface BreezeAutoBuySettings {
  enabled: boolean;
  strongSwingEnabled: boolean;
  adaptiveAllocationEnabled: boolean;
  dailyBudget: number;
  maxOrderValue: number;
  maxOrdersPerDay: number;
  limitBufferBps: number;
  acknowledgedAt: string | null;
}

export const DEFAULT_AUTO_BUY_SETTINGS: BreezeAutoBuySettings = {
  enabled: false, strongSwingEnabled: false, adaptiveAllocationEnabled: false,
  dailyBudget: 0, maxOrderValue: 0, maxOrdersPerDay: 1, limitBufferBps: 10, acknowledgedAt: null,
};

export async function getBreezeAutoBuySettings(userId?: string): Promise<BreezeAutoBuySettings> {
  const user = userId ? { id: userId } : await getSessionUser();
  if (!user) return DEFAULT_AUTO_BUY_SETTINGS;
  const row = await queryOne<{
    enabled: boolean; strong_swing_enabled: boolean; adaptive_allocation_enabled: boolean;
    daily_budget: string; max_order_value: string; max_orders_per_day: number;
    limit_buffer_bps: string; acknowledged_at: string | Date | null;
  }>("select * from public.breeze_auto_buy_settings where user_id=$1", [user.id]);
  if (!row) return DEFAULT_AUTO_BUY_SETTINGS;
  return {
    enabled: row.enabled,
    strongSwingEnabled: row.strong_swing_enabled,
    adaptiveAllocationEnabled: row.adaptive_allocation_enabled,
    dailyBudget: Number(row.daily_budget), maxOrderValue: Number(row.max_order_value),
    maxOrdersPerDay: row.max_orders_per_day, limitBufferBps: Number(row.limit_buffer_bps),
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
  };
}
