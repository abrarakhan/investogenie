"use client";
import { useEffect, useState } from "react";

/**
 * Says how old the scan behind a screen is, whenever that is older than a few
 * refresh cycles.
 *
 * The display cache serves the last good result when a refresh fails, so a
 * screen can legitimately show figures computed minutes ago. These are trade
 * setups: the age has to be on the screen, not only in the server log. The age
 * is computed on the client so it keeps counting up on a tab left open, which
 * is exactly the situation this warns about.
 */
export default function StaleScanNotice({
  computedAt,
  staleAfterMs,
}: {
  /** Epoch ms the oldest scan on this screen was computed; 0 when unknown. */
  computedAt: number;
  staleAfterMs: number;
}) {
  const [ageMs, setAgeMs] = useState<number | null>(null);

  useEffect(() => {
    if (!computedAt) return;
    const tick = () => setAgeMs(Date.now() - computedAt);
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [computedAt]);

  if (!computedAt || ageMs === null || ageMs < staleAfterMs) return null;

  const minutes = Math.floor(ageMs / 60_000);
  const age = minutes >= 1
    ? `${minutes} minute${minutes === 1 ? "" : "s"}`
    : `${Math.floor(ageMs / 1000)} seconds`;

  return (
    <div
      role="status"
      className="mb-6 rounded border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200"
    >
      <span className="font-bold">Showing a scan from {age} ago.</span>{" "}
      The latest refresh did not complete, so these levels are not current. Re-check the live
      price and spread with your broker before acting on anything below.
    </div>
  );
}
