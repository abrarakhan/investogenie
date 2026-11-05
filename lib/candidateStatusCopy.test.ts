import { describe, expect, it } from "vitest";
import { SWING_VERDICT_LABEL, swingBuildupLabel, swingVerdictLabel } from "@/lib/candidateStatusCopy";

describe("base Swing wording", () => {
  it("describes evidence and never implies execution authority", () => {
    for (const label of Object.values(SWING_VERDICT_LABEL)) {
      expect(label.toLowerCase()).not.toMatch(/\bbuy\b|confirm/);
    }
    expect(swingVerdictLabel("LONG_BREAKOUT")).toBe("Breakout + build-up");
    expect(swingVerdictLabel("SOMETHING_NEW")).toBe("something new");
  });

  it("names the cash build-up as volume participation, not breakout-day confirmation", () => {
    expect(swingBuildupLabel("VOLUME")).toBe("Volume participation build-up");
    expect(swingBuildupLabel("OI")).toBe("OI long build-up");
  });
});
