import { describe, expect, it } from "vitest";
import { LONG_TERM_STRATEGY_KEYS, criteriaFor } from "@/lib/analytics/longTermStrategies";

describe("Long-Term declarative rules", () => {
  it("defines weighted criteria for all six published strategies in both markets", () => {
    expect(LONG_TERM_STRATEGY_KEYS).toHaveLength(6);
    for (const market of ["IN", "US"] as const) {
      for (const key of LONG_TERM_STRATEGY_KEYS) {
        const criteria = criteriaFor(key, market);
        expect(criteria.length).toBeGreaterThanOrEqual(4);
        expect(criteria.every((criterion) => criterion.weight > 0 && Number.isFinite(criterion.target))).toBe(true);
      }
    }
  });
});
