import "server-only";
/**
 * One-off warm-up of the display scans after the server starts, so the first
 * visit after a deploy or restart does not wait for a full market scan.
 *
 * Runs once, one scan at a time, for the default risk settings and the distinct
 * settings users have saved (capped). It counts as a read, so the normal
 * keep-warm runs for its 5-minute window and then stops unless someone visits;
 * there is no standing background load.
 */
import { query } from "@/lib/db";
import { DEFAULT_SETTINGS, type SwingSettings } from "@/lib/settings";
import {
  displayArmedSwing,
  displayLegacyMomentum,
  displayMarketOverview,
  displayMomentumV2,
  displayStrongSwing,
  displayTrendContinuation,
} from "@/lib/displayScanCache";
import type { MarketId } from "@/lib/types";

const MAX_SETTINGS_SETS = 3;
const MARKETS: MarketId[] = ["IN", "US"];

interface Row { stop_atr_mult: string; target_rr: string; trail_atr_mult: string; include_short: boolean }

export async function warmupSettings(): Promise<SwingSettings[]> {
  const rows = await query<Row>(
    `select distinct stop_atr_mult::text, target_rr::text, trail_atr_mult::text, include_short
       from public.user_swing_settings limit $1`,
    [MAX_SETTINGS_SETS],
  );
  const sets = [DEFAULT_SETTINGS, ...rows.map((row) => ({
    stopAtrMult: Number(row.stop_atr_mult),
    targetRR: Number(row.target_rr),
    trailAtrMult: Number(row.trail_atr_mult),
    includeShort: Boolean(row.include_short),
  }))];
  const seen = new Set<string>();
  return sets.filter((set) => {
    const key = JSON.stringify([set.stopAtrMult, set.targetRR, set.trailAtrMult, set.includeShort]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_SETTINGS_SETS);
}

export async function warmDisplayScans(): Promise<{ warmed: number; failed: number; ms: number }> {
  const started = Date.now();
  const settingsSets = await warmupSettings();
  const jobs: Array<() => Promise<unknown>> = [];
  for (const market of MARKETS) {
    for (const settings of settingsSets) {
      jobs.push(
        () => displayStrongSwing(market, settings),
        () => displayLegacyMomentum(market, settings),
        () => displayMomentumV2(market, settings),
        () => displayArmedSwing(market, settings),
      );
    }
    jobs.push(() => displayTrendContinuation(market), () => displayMarketOverview(market));
  }
  let warmed = 0;
  let failed = 0;
  for (const job of jobs) {
    try { await job(); warmed++; } catch { failed++; }
  }
  return { warmed, failed, ms: Date.now() - started };
}
