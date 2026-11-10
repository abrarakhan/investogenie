"use server";

import { getSessionUser } from "@/lib/auth";
import { normalizeMarket } from "@/lib/markets";
import { getUserSwingSettings } from "@/lib/settings";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rateLimit";
import { displayArmedSwing, displayLegacyMomentum, displayMomentumV2, displayStrongSwing, displayTrendContinuation } from "@/lib/displayScanCache";
import { trimArmedSwingForDisplay, trimStrongSwingForDisplay } from "@/lib/candidateDisplay";
import { LAZY_STATUSES, pickLazyGroup, type LazyScreen } from "@/lib/lazyCandidateGroups";

export interface LazyGroupResult {
  ok: boolean;
  error?: string;
  items: unknown[];
  ranks: Record<string, number>;
}

/**
 * Cards for one collapsed candidate group, read from the same shared display
 * scan the page used. Only deferrable (never-buyable) groups can be requested.
 */
export async function loadCandidateGroup(screen: LazyScreen, marketParam: string, status: string): Promise<LazyGroupResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in", items: [], ranks: {} };
  const market = normalizeMarket(marketParam);
  const lazy = Object.hasOwn(LAZY_STATUSES, screen) ? LAZY_STATUSES[screen] : null;
  if (!market || !lazy || !lazy.has(status)) return { ok: false, error: "Unknown group", items: [], ranks: {} };
  if (!checkRateLimit(`candidate-group:user:${user.id}`, RATE_LIMITS.screener).ok) {
    return { ok: false, error: "Too many requests. Try again in a minute.", items: [], ranks: {} };
  }

  const settings = await getUserSwingSettings();
  switch (screen) {
    case "strong":
      return { ok: true, ...pickLazyGroup(trimStrongSwingForDisplay(await displayStrongSwing(market, settings)).candidates, status) };
    case "armed":
      return { ok: true, ...pickLazyGroup(trimArmedSwingForDisplay((await displayArmedSwing(market, settings)).candidates).candidates, status) };
    case "momentum-legacy":
      return { ok: true, ...pickLazyGroup((await displayLegacyMomentum(market, settings)).candidates, status) };
    case "momentum-v2":
      return { ok: true, ...pickLazyGroup((await displayMomentumV2(market, settings)).candidates, status) };
    case "trend":
      return { ok: true, ...pickLazyGroup(await displayTrendContinuation(market), status) };
  }
}
