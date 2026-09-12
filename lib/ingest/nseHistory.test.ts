import { describe, expect, it } from "vitest";
import { historyBackfillStart } from "@/lib/ingest/nseHistory";

describe("historyBackfillStart", () => {
  const end = new Date("2026-09-12T00:00:00Z");

  it("replays recent sessions when the exchange-wide history is current", () => {
    expect(historyBackfillStart("2026-09-11", end).toISOString().slice(0, 10)).toBe("2026-09-04");
  });

  it("continues from an older exchange-wide gap", () => {
    expect(historyBackfillStart("2026-08-20", end).toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("honours an explicit repair date", () => {
    expect(historyBackfillStart("2026-09-11", end, "2026-08-01").toISOString().slice(0, 10)).toBe("2026-08-01");
  });
});
