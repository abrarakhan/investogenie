"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { getActiveAIConfig, getActiveNewsConfig } from "@/lib/credentials-actions";
import { normalizeMarket } from "@/lib/markets";
import { refreshNewsIntelligence } from "@/lib/news/sync";

export interface RefreshNewsState {
  ok: boolean;
  message: string;
}
export async function refreshNewsSwing(
  _previous: RefreshNewsState,
  formData: FormData,
): Promise<RefreshNewsState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Sign in before refreshing news." };
  const market = normalizeMarket(String(formData.get("market") ?? ""));
  if (!market) return { ok: false, message: "Invalid market." };
  const [news, ai] = await Promise.all([getActiveNewsConfig(), getActiveAIConfig()]);
  if (!news) return { ok: false, message: "Add a News API key in Settings first." };
  try {
    const summary = await refreshNewsIntelligence(market, news, ai);
    revalidatePath(`/terminal/${market.toLowerCase()}/news-swing`);
    revalidatePath(`/terminal/${market.toLowerCase()}/trade-ledger`);
    return {
      ok: true,
      message: `${summary.stored} articles refreshed; ${summary.impacts} event impacts classified via ${summary.analysisSource}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "News refresh failed." };
  }
}
