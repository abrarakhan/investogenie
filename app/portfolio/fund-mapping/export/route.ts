import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getFundMappingData } from "@/lib/funds/fundMappingStore";

export const dynamic = "force-dynamic";

function csv(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const data = await getFundMappingData(user.id);
  const snapshots = new Map(data.snapshots.map((s) => [s.schemeCode, s]));
  const lines = [
    ["CAS fund name", "ISIN", "AMC", "status", "mapped scheme name", "mapped scheme ISIN", "snapshot month"].join(","),
    ...data.funds.map((fund) => {
      const mapped = fund.mappedSchemeCode ? snapshots.get(fund.mappedSchemeCode) : fund.suggestion.schemeCode ? snapshots.get(fund.suggestion.schemeCode) : null;
      return [fund.fundName, fund.isin, fund.amc, fund.displayStatus, mapped?.name, mapped?.isin, mapped?.snapshotMonth].map(csv).join(",");
    }),
  ];
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=investogenie-fund-mapping.csv",
    },
  });
}
