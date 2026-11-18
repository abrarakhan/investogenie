import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REBUILD_SQL } from "./snapshot";

describe("screener snapshot refresh contracts", () => {
  it("keeps CLI and application rebuilds wired to historical fundamentals", () => {
    const cliSql = readFileSync(resolve("db/screener_snapshot_rebuild.sql"), "utf8");
    for (const sql of [REBUILD_SQL, cliSql]) {
      expect(sql).toContain("screener_fundamental_latest");
      expect(sql).toContain("asset_shareholding_reports");
      expect(sql).toContain("profit_cagr_3y");
      expect(sql).toContain("promoter_holding_change_qoq");
      for (const column of [
        "deliv_pct", "rel_deliv_20d", "nifty_alpha_1d", "ibs_close",
        "tod_rvol", "days_since_results", "setup_variant", "catalyst_tag",
      ]) {
        expect(sql).toContain(column);
      }
    }
  });
});
