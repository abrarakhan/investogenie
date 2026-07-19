// FundDataProvider: the seam between "where holdings come from" and everything
// that consumes them (sync, overlap engine, X-Ray UI).
//
// Priority is deliberately inverted from the original plan. AMC monthly
// disclosures are PRIMARY because that parser already exists and works, and
// because it depends on nobody's uptime. mfdata.in is a structural stub: it
// returned Cloudflare 522 (origin unreachable) on first contact from two
// networks, which is not a foundation for a sync job. It stays behind this
// interface so it can be promoted to a bulk-backfill source later without the
// engine or UI changing.

export type FundInstrumentType = "EQUITY" | "DEBT" | "CASH_EQUIVALENT" | "DERIVATIVE" | "OTHER";

export interface SchemeMeta {
  schemeCode: string;
  name: string;
  isin: string | null;        // ISIN of the scheme itself, not its holdings
  amc: string | null;
  category: string | null;    // Equity / Debt / Hybrid
  subCategory: string | null; // Flexi Cap / Large Cap ...
}

export interface HoldingLine {
  /** Real ISIN, or a pseudo-key for instruments that have none. Overlap joins
   *  on this and ONLY this — factsheets spell one company many ways. */
  instrumentIsin: string;
  instrumentName: string;
  weightPct: number;
  sector: string | null;
  instrumentType: FundInstrumentType;
  // Debt sleeve, present only when disclosed.
  rating?: string | null;
  maturityDate?: string | null;
  couponPct?: number | null;
}

export interface HoldingsSnapshot {
  schemeCode: string;
  /** First day of the disclosure month. Holdings are monthly by nature. */
  month: string;
  lines: HoldingLine[];
  source: string;
}

export interface FundDataProvider {
  readonly name: string;
  /** True when this provider can currently serve requests. The sync tries
   *  providers in priority order and skips any that report unavailable, so a
   *  dead upstream degrades to cached data instead of failing the tab. */
  isAvailable(): Promise<boolean>;
  searchSchemes(query: string): Promise<SchemeMeta[]>;
  getSchemeMeta(schemeCode: string): Promise<SchemeMeta | null>;
  /** `month` omitted = latest available snapshot. */
  getHoldings(schemeCode: string, month?: string): Promise<HoldingsSnapshot | null>;
  /** Months for which this provider holds a snapshot, newest first. */
  listSnapshots(schemeCode: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Normalisation helpers — shared by every provider so classification cannot
// drift between sources.
// ---------------------------------------------------------------------------

const CASH_PATTERNS = /\b(TREPS|TRP_|CBLO|REPO|CASH|NET\s+(CURRENT\s+)?ASSET|NET\s+RECEIVABLE|MARGIN|BANK\s+BALANCE|CLEARING\s+CORP)/i;
const DERIVATIVE_PATTERNS = /\b(FUTURE|FUT\b|OPTION|CALL\b|PUT\b|SWAP|FORWARD)/i;
const DEBT_PATTERNS = /\b(NCD|DEBENTURE|BONDS?|GOI|G[- ]?SEC|SDL|T[- ]?BILL|TREASURY|GOVERNMENT\s+SECURIT|CERTIFICATE\s+OF\s+DEPOSIT|COMMERCIAL\s+PAPER|STRIPS)\b|^\d+(?:\.\d+)?%\s/i;

/** Classify a factsheet line. Cash, TREPS and derivatives carry no ISIN; they
 *  must appear in allocation but must never count toward stock overlap — two
 *  funds each parking 5% in TREPS are not 5% overlapped. Debt matters for the
 *  same reason: g-secs and NCDs DO carry ISINs, so without this branch they
 *  would classify as EQUITY and count toward overlap. Government ISINs live in
 *  the IN<digit> namespace (corporates are INE, fund units INF). */
export function classifyInstrument(name: string, isin: string | null): FundInstrumentType {
  if (DERIVATIVE_PATTERNS.test(name)) return "DERIVATIVE";
  if (CASH_PATTERNS.test(name)) return "CASH_EQUIVALENT";
  if (DEBT_PATTERNS.test(name) || (isin !== null && /^IN\d/.test(isin))) return "DEBT";
  if (!isin) return "OTHER";
  return "EQUITY";
}

/** Stable key for instruments with no ISIN, so they can still be stored under
 *  the (scheme, month, instrument) primary key without colliding. */
export function pseudoIsin(type: FundInstrumentType, name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40);
  const prefix = type === "CASH_EQUIVALENT" ? "CASH" : type === "DERIVATIVE" ? "DERIV" : "OTHER";
  return `${prefix}:${slug}`;
}

export const WEIGHT_TOLERANCE_PCT = 2;

/** Weights should sum to ~100. Anything outside tolerance means a partial or
 *  malformed factsheet; validate at INGEST, because a bad snapshot silently
 *  poisons every overlap number later computed from it. */
export function validateWeights(lines: HoldingLine[]): { total: number; ok: boolean; reason?: string } {
  const total = lines.reduce((s, l) => s + (Number.isFinite(l.weightPct) ? l.weightPct : 0), 0);
  const ok = Math.abs(100 - total) <= WEIGHT_TOLERANCE_PCT;
  return { total, ok, reason: ok ? undefined : `weights sum to ${total.toFixed(2)}%, outside ±${WEIGHT_TOLERANCE_PCT}%` };
}

// ---------------------------------------------------------------------------
// Secondary: mfdata.in. Structural stub only.
// ---------------------------------------------------------------------------

/** TODO(mfdata): the origin returned Cloudflare 522 from two separate networks,
 *  so the response shapes are UNCONFIRMED. Do not implement these methods
 *  against guessed payloads — capture real responses first:
 *    curl -s "https://mfdata.in/api/scheme/search?q=parag" | head -c 1500
 *  Until then isAvailable() reports false and the sync skips this provider
 *  entirely, falling through to the AMC disclosure path. */
export class MfDataProvider implements FundDataProvider {
  readonly name = "MFDATA";
  constructor(private readonly baseUrl = "https://mfdata.in") {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`, { method: "HEAD", signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async searchSchemes(): Promise<SchemeMeta[]> { return []; }
  async getSchemeMeta(): Promise<SchemeMeta | null> { return null; }
  async getHoldings(): Promise<HoldingsSnapshot | null> { return null; }
  async listSnapshots(): Promise<string[]> { return []; }
}
