/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.DISPLAY_SCAN_WARMUP === "0") return;
  // Let the server finish starting and serve its first requests before scanning.
  const timer = setTimeout(async () => {
    try {
      const { warmDisplayScans } = await import("@/lib/displayScanWarmup");
      const { warmed, failed, ms } = await warmDisplayScans();
      console.log(`[display-scan] start-up warm-up: ${warmed} screens ready${failed ? `, ${failed} failed` : ""} in ${(ms / 1000).toFixed(1)} s`);
    } catch (error) {
      console.warn("[display-scan] start-up warm-up failed:", error instanceof Error ? error.message : error);
    }
  }, 15_000);
  timer.unref?.();
}
