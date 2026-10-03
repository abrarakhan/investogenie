"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

const clamp = (n: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

export async function saveSwingSettings(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const stop = clamp(Number(formData.get("stop_atr_mult")), 0.25, 10, 1.5);
  const rr = clamp(Number(formData.get("target_rr")), 0.5, 10, 2);
  const trail = clamp(Number(formData.get("trail_atr_mult")), 0.5, 15, 3);
  const includeShort = formData.get("include_short") === "on";

  await query(
    `insert into public.user_swing_settings
       (user_id, stop_atr_mult, target_rr, trail_atr_mult, include_short, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (user_id) do update set
       stop_atr_mult = excluded.stop_atr_mult, target_rr = excluded.target_rr,
       trail_atr_mult = excluded.trail_atr_mult, include_short = excluded.include_short,
       updated_at = now()`,
    [user.id, stop, rr, trail, includeShort],
  );

  revalidatePath("/terminal/us");
  revalidatePath("/terminal/in");
  redirect(String(formData.get("returnTo") || "/terminal/us"));
}

export async function resetSwingSettings(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await query("delete from public.user_swing_settings where user_id = $1", [user.id]);
  revalidatePath("/terminal/us");
  revalidatePath("/terminal/in");
  redirect(String(formData.get("returnTo") || "/settings"));
}

export async function saveBreezeAutoBuySettings(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const enabled = formData.get("enabled") === "on";
  const strong = formData.get("strong_swing_enabled") === "on";
  const adaptive = formData.get("adaptive_allocation_enabled") === "on";
  const dailyBudget = clamp(Number(formData.get("daily_budget")), 0, 10_000_000, 0);
  const maxOrderValue = clamp(Number(formData.get("max_order_value")), 0, 10_000_000, 0);
  const maxOrders = Math.round(clamp(Number(formData.get("max_orders_per_day")), 1, 20, 1));
  const bufferBps = clamp(Number(formData.get("limit_buffer_bps")), 0, 100, 10);
  const acknowledged = formData.get("acknowledge_live_orders") === "on";
  if (enabled && (!acknowledged || (!strong && !adaptive) || dailyBudget <= 0 || maxOrderValue <= 0)) {
    throw new Error("To enable live buying, select an engine, set positive limits, and acknowledge real-money orders.");
  }
  if (enabled) {
    const credentials = await query<{ configured: boolean }>(
      `select breeze_api_key_encrypted is not null and breeze_api_secret_encrypted is not null
          and breeze_session_token_encrypted is not null configured from public.user_credentials where user_id=$1`,
      [user.id],
    );
    if (!credentials[0]?.configured) throw new Error("Connect Breeze and save today's session before enabling live buying.");
  }
  await query(
    `insert into public.breeze_auto_buy_settings
       (user_id,enabled,strong_swing_enabled,adaptive_allocation_enabled,daily_budget,max_order_value,
        max_orders_per_day,limit_buffer_bps,acknowledged_at,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,case when $2 then now() else null end,now())
     on conflict(user_id) do update set enabled=excluded.enabled,strong_swing_enabled=excluded.strong_swing_enabled,
       adaptive_allocation_enabled=excluded.adaptive_allocation_enabled,daily_budget=excluded.daily_budget,
       max_order_value=excluded.max_order_value,max_orders_per_day=excluded.max_orders_per_day,
       limit_buffer_bps=excluded.limit_buffer_bps,acknowledged_at=excluded.acknowledged_at,updated_at=now()`,
    [user.id, enabled, strong, adaptive, dailyBudget, maxOrderValue, maxOrders, bufferBps],
  );
  revalidatePath("/settings");
  redirect("/settings?autoBuy=" + (enabled ? "enabled" : "disabled"));
}
