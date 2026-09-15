import { describe, expect, it } from "vitest";
import { prioritizeNewsCandidates } from "./sync";

const row = (asset_id: string, ticker: string) => ({ asset_id, ticker, name: ticker, sector: null });

describe("news candidate priority", () => {
  it("prioritizes ledger, then Strong Swing, then ordinary Swing and removes duplicates", () => {
    const result = prioritizeNewsCandidates(
      [row("held", "HELD")],
      [row("strong", "STRONG"), row("held", "HELD")],
      [row("swing", "SWING"), row("strong", "STRONG")],
    );
    expect(result.map((item) => item.ticker)).toEqual(["HELD", "STRONG", "SWING"]);
  });
});
