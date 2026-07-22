import type { MatchStatus } from "@/lib/status";

export interface UserFundForMapping {
  holdingId: string;
  assetId: string;
  fundName: string;
  isin: string | null;
  amc: string | null;
  currentValue: number;
  mappedSchemeCode: string | null;
  mappingStatus: "matched" | "rejected" | null;
  rejectedSchemeCode?: string | null;
}

export interface SnapshotSchemeForMapping {
  schemeCode: string;
  name: string;
  isin: string | null;
  amc: string | null;
  category: string | null;
  snapshotMonth: string | null;
  holdingCount: number;
}

export interface FundMatchSuggestion {
  status: MatchStatus;
  schemeCode: string | null;
  confidence: number | null;
  method: "isin_exact" | "name_similarity" | "ambiguous_isin" | "none";
  reason: string;
  candidates: SnapshotSchemeForMapping[];
}

const AMC_PREFIXES: Array<[RegExp, string]> = [
  [/INF209|ADITYA\s+BIRLA|ABSL/i, "Aditya Birla Sun Life MF"],
  [/INF760|CANARA\s+ROBECO/i, "Canara Robeco MF"],
  [/INF740|\bDSP\b/i, "DSP MF"],
  [/INF090|FRANKLIN|TEMPLETON/i, "Franklin Templeton India"],
  [/INF179|\bHDFC\b/i, "HDFC MF"],
  [/INF109|ICICI|PRUDENTIAL/i, "ICICI Prudential MF"],
  [/INF204|NIPPON/i, "Nippon India MF"],
  [/INF200|\bSBI\b/i, "SBI MF"],
  [/INF966|\bQUANT\b/i, "Quant MF"],
  [/INF247|MOTILAL\s+OSWAL/i, "Motilal Oswal MF"],
  [/INA100|ICICI|PRUDENTIAL/i, "ICICI Prudential MF"],
];

export function inferAmc(name: string | null | undefined, isin: string | null | undefined): string | null {
  const haystack = `${isin ?? ""} ${name ?? ""}`;
  return AMC_PREFIXES.find(([pattern]) => pattern.test(haystack))?.[1] ?? null;
}

export function normalizeFundName(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/\b(DIRECT|REGULAR|GROWTH|IDCW|REINVESTMENT|PAYOUT|PLAN|OPTION|FUND|SCHEME)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameAmc(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return normalizeFundName(a).includes(normalizeFundName(b)) || normalizeFundName(b).includes(normalizeFundName(a));
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(4, a.length, b.length);
  let count = 0;
  while (count < max && a[count] === b[count]) count += 1;
  return count;
}

export function jaroWinkler(aRaw: string, bRaw: string): number {
  const a = normalizeFundName(aRaw);
  const b = normalizeFundName(bRaw);
  if (a === b) return 1;
  if (!a || !b) return 0;

  const matchDistance = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  const prefix = commonPrefixLength(a, b);
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function suggestFundMapping(
  fund: UserFundForMapping,
  snapshots: SnapshotSchemeForMapping[],
): FundMatchSuggestion {
  if (fund.mappingStatus === "matched" && fund.mappedSchemeCode) {
    const mapped = snapshots.find((s) => s.schemeCode === fund.mappedSchemeCode);
    return { status: "matched", schemeCode: fund.mappedSchemeCode, confidence: 1, method: "none", reason: "Already mapped", candidates: mapped ? [mapped] : [] };
  }
  if (fund.mappingStatus === "rejected") {
    return { status: "rejected", schemeCode: null, confidence: null, method: "none", reason: "Rejected by user", candidates: [] };
  }

  const inferredAmc = fund.amc ?? inferAmc(fund.fundName, fund.isin);
  const amcSnapshots = snapshots.filter((s) => sameAmc(inferredAmc, s.amc));
  const searchSpace = amcSnapshots.length > 0 ? amcSnapshots : snapshots;

  if (fund.isin) {
    const isinMatches = searchSpace.filter((s) => s.isin && s.isin.toUpperCase() === fund.isin!.toUpperCase());
    if (isinMatches.length === 1) {
      return { status: "pending", schemeCode: isinMatches[0].schemeCode, confidence: 1, method: "isin_exact", reason: "ISIN match", candidates: isinMatches };
    }
    if (isinMatches.length > 1) {
      return { status: "ambiguous", schemeCode: null, confidence: 1, method: "ambiguous_isin", reason: "Multiple schemes share this ISIN", candidates: isinMatches };
    }
  }

  if (amcSnapshots.length === 0) {
    return { status: "no_snapshot", schemeCode: null, confidence: null, method: "none", reason: inferredAmc ? `No disclosure loaded for ${inferredAmc}` : "No disclosure loaded for this AMC", candidates: [] };
  }

  const ranked = amcSnapshots
    .map((s) => ({ scheme: s, score: jaroWinkler(fund.fundName, s.name) }))
    .filter((row) => row.score >= 0.85)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return { status: "pending", schemeCode: null, confidence: null, method: "none", reason: `${amcSnapshots.length} snapshots available for ${inferredAmc ?? "this AMC"}`, candidates: amcSnapshots };
  }
  const topScore = ranked[0].score;
  const tied = ranked.filter((row) => Math.abs(row.score - topScore) < 0.015).map((row) => row.scheme);
  if (tied.length > 1) {
    return { status: "ambiguous", schemeCode: null, confidence: topScore, method: "name_similarity", reason: `Name similarity: ${Math.round(topScore * 100)}%`, candidates: tied };
  }
  return { status: "pending", schemeCode: ranked[0].scheme.schemeCode, confidence: topScore, method: "name_similarity", reason: `Name similarity: ${Math.round(topScore * 100)}%`, candidates: [ranked[0].scheme] };
}

export function summarizeMapping(funds: Array<UserFundForMapping & { suggestion: FundMatchSuggestion }>) {
  const matched = funds.filter((f) => f.suggestion.status === "matched").length;
  const rejected = funds.filter((f) => f.suggestion.status === "rejected").length;
  return {
    imported: funds.length,
    matched,
    rejected,
    pending: funds.length - matched - rejected,
  };
}
