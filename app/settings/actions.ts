"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

const clamp = (n: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

export async function saveSwingSettings(formData: FormData): Promise<void> {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const stop = clamp(Number(formData.get("stop_atr_mult")), 0.25, 10, 1.5);
  const rr = clamp(Number(formData.get("target_rr")), 0.5, 10, 2);
  const trail = clamp(Number(formData.get("trail_atr_mult")), 0.5, 15, 3);
  const includeShort = formData.get("include_short") === "on";

  await supabase.from("user_swing_settings").upsert({
    user_id: user.id,
    stop_atr_mult: stop,
    target_rr: rr,
    trail_atr_mult: trail,
    include_short: includeShort,
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/terminal/us");
  revalidatePath("/terminal/in");
  redirect(String(formData.get("returnTo") || "/terminal/us"));
}

export async function resetSwingSettings(formData: FormData): Promise<void> {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase.from("user_swing_settings").delete().eq("user_id", user.id);
  revalidatePath("/terminal/us");
  revalidatePath("/terminal/in");
  redirect(String(formData.get("returnTo") || "/settings"));
}
