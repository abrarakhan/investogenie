import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("trade-ledger action SQL", () => {
  it("casts numeric parameters before calculating purchase value", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/terminal/[market]/trade-ledger/actions.ts"),
      "utf8",
    );

    expect(source).toContain("$6::numeric*$7::numeric");
    expect(source).toContain("purchase_value=$2::numeric*$3::numeric");
    expect(source).not.toContain("$6*$7");
    expect(source).not.toContain("purchase_value=$2*$3");
  });
});
