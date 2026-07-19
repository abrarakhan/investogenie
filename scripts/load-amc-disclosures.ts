// Load one AMC monthly portfolio disclosure file into the fund snapshot
// tables via AmcDisclosureProvider, then print the top holdings so the result
// can be eyeballed against the published factsheet. Run:
//   npx tsx scripts/load-amc-disclosures.ts <file> \
//     --scheme-code PPFAS_FLEXI_CAP --name "Parag Parikh Flexi Cap Fund" \
//     --month 2026-06 [--amc PPFAS] [--sheet PPFCF] [--isin INF879O01027] \
//     [--category Equity] [--sub-category "Flexi Cap"] [--top 10]
import { parseArgs } from "node:util";
import {
  AmcDisclosureProvider,
  parseDisclosureSource,
  SnapshotRejectedError,
} from "../lib/funds/amcProvider";
import { pool } from "../lib/db";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "scheme-code": { type: "string" },
    name: { type: "string" },
    amc: { type: "string" },
    month: { type: "string" },
    sheet: { type: "string" },
    isin: { type: "string" },
    category: { type: "string" },
    "sub-category": { type: "string" },
    top: { type: "string", default: "10" },
  },
});

const file = positionals[0];
const schemeCode = values["scheme-code"];
const schemeName = values.name;
const month = values.month;
if (!file || !schemeCode || !schemeName || !month) {
  console.error(
    "usage: npx tsx scripts/load-amc-disclosures.ts <file> --scheme-code X --name N --month YYYY-MM" +
      " [--amc A] [--sheet S] [--isin I] [--category C] [--sub-category SC] [--top 10]",
  );
  process.exit(1);
}

async function main(file: string, schemeCode: string, schemeName: string, month: string): Promise<void> {
try {
  const parsed = await parseDisclosureSource({ path: file }, { full: true, sheet: values.sheet });
  if (typeof parsed === "string") {
    console.error(`parse failed: ${parsed}`);
    process.exit(2);
  }
  console.log(`parsed ${parsed.rows.length} lines from ${file}${values.sheet ? ` (sheet ~ "${values.sheet}")` : ""}`);

  const provider = new AmcDisclosureProvider();
  const snapshot = await provider.ingestSnapshot({
    meta: {
      schemeCode,
      name: schemeName,
      isin: values.isin ?? null,
      amc: values.amc ?? null,
      category: values.category ?? null,
      subCategory: values["sub-category"] ?? null,
    },
    month,
    rows: parsed.rows,
  });

  const total = snapshot.lines.reduce((s, l) => s + l.weightPct, 0);
  const counts = new Map<string, number>();
  for (const line of snapshot.lines) counts.set(line.instrumentType, (counts.get(line.instrumentType) ?? 0) + 1);
  const countsText = [...counts.entries()].map(([t, n]) => `${t}=${n}`).join(" ");
  console.log(`INGESTED ${schemeCode} ${snapshot.month}: ${snapshot.lines.length} lines, total ${total.toFixed(2)}% (${countsText})`);

  const topN = Number(values.top) || 10;
  const top = snapshot.lines.filter((l) => l.instrumentType === "EQUITY").slice(0, topN);
  console.log(`\nTop ${top.length} equity holdings — ${schemeName} (${snapshot.month}):`);
  for (const [i, line] of top.entries()) {
    const rank = String(i + 1).padStart(2);
    const weight = `${line.weightPct.toFixed(2)}%`.padStart(7);
    console.log(`  ${rank}. ${weight}  ${line.instrumentName}  [${line.instrumentIsin}]`);
  }
} catch (error) {
  if (error instanceof SnapshotRejectedError) {
    console.error(`REJECTED: ${error.message}`);
    process.exit(3);
  }
  throw error;
} finally {
  await pool.end();
}
}

main(file, schemeCode, schemeName, month);
