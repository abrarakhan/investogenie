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
