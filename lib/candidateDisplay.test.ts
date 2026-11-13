import { describe, expect, it } from "vitest";
import { rankStrongSwingCandidates } from "@/lib/analytics/candidateRanking";
import { trimArmedSwingForDisplay, trimStrongSwingForDisplay } from "@/lib/candidateDisplay";

type S = "EXECUTION_READY" | "WAIT_FOR_ENTRY" | "WATCHLIST" | "RISK_OFF" | "INVALIDATED";
const strong = (status: S, i: number) => ({ ticker: `${status}${String(i).padStart(3, "0")}`, status, strengthScore: (i * 37) % 100, score: i % 7 });

describe("trimStrongSwingForDisplay", () => {
  const unsorted = [
    ...Array.from({ length: 4 }, (_, i) => strong("EXECUTION_READY", i)),
    ...Array.from({ length: 45 }, (_, i) => strong("WAIT_FOR_ENTRY", i)),
    ...Array.from({ length: 300 }, (_, i) => strong("WATCHLIST", i)),
    ...Array.from({ length: 80 }, (_, i) => strong("RISK_OFF", i)),
    ...Array.from({ length: 345 }, (_, i) => strong("INVALIDATED", i)),
  ].reverse();
  // Production receives this order from Python. The former TypeScript ranker
  // remains a test oracle while the migration is being verified.
  const all = rankStrongSwingCandidates(unsorted);

  it("keeps exactly the cards the page renders, in the page's order, with exact totals", () => {
    const { candidates, counts } = trimStrongSwingForDisplay(all);
    expect(counts).toEqual({ EXECUTION_READY: 4, WAIT_FOR_ENTRY: 45, WATCHLIST: 300, RISK_OFF: 80, INVALIDATED: 345 });
    // What StrongSwingCandidates shows from the full list…
    const of = (status: S) => all.filter((c) => c.status === status);
    const expected = [...of("EXECUTION_READY"), ...of("WAIT_FOR_ENTRY"), ...of("WATCHLIST").slice(0, 30), ...of("RISK_OFF").slice(0, 30), ...of("INVALIDATED").slice(0, 20)];
    // …is identical to the already-ranked Python result after trimming.
    expect(candidates.map((c) => c.ticker)).toEqual(expected.map((c) => c.ticker));
    expect(candidates).toHaveLength(4 + 45 + 30 + 30 + 20);
  });
});

describe("trimArmedSwingForDisplay", () => {
  it("keeps the first 30 of each status in result order and reports totals", () => {
    const statuses = ["ARMED", "FORMING", "RISK_OFF"] as const;
    const all = Array.from({ length: 150 }, (_, i) => ({ id: i, status: statuses[i % 3] }));
    const { candidates, counts, assessedCount } = trimArmedSwingForDisplay(all);
    expect(counts).toEqual({ ARMED: 50, FORMING: 50, RISK_OFF: 50 });
    expect(assessedCount).toBe(150);
    for (const status of statuses) {
      expect(candidates.filter((c) => c.status === status).map((c) => c.id))
        .toEqual(all.filter((c) => c.status === status).slice(0, 30).map((c) => c.id));
    }
  });
});
