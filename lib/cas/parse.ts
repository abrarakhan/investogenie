// =============================================================================
// CAS statement parsing
// -----------------------------------------------------------------------------
// Pure text-to-holdings parsing for CAMS/KFintech/NSDL/CDSL consolidated
// account statements. Four strategies run over the extracted text (structured
// CSV/TSV, loose labelled text, ISIN-anchored lines, numeric-tail lines) and
// every candidate row must pass a plausibility gate: footnote/disclaimer names
// are rejected, folio-style numbers are never treated as quantities, and
// quantity × price must reconcile with the row's value.
// =============================================================================

export type ImportedAssetClass = "MUTUAL_FUND" | "STOCK";

export interface ParsedHoldingRow {
  name: string;
  folio: string | null;
  isin: string | null;
  quantity: number;
  price: number | null;
  value: number;
  costValue?: number | null;
  asOfDate?: string | null;
  holderName?: string | null;
  assetClass: ImportedAssetClass;
}

const money = (value: string | undefined | null) => {
  if (!value) return NaN;
  const cleaned = value.replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  return Number(cleaned);
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if ((ch === "," || ch === "\t") && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function looksLikeHeader(cells: string[]) {
  const joined = cells.map(normalizeHeader).join(" ");
  const hasQuantity = joined.includes("unit") || joined.includes("quantity") || joined.includes("balance");
  const hasValue = joined.includes("market") || joined.includes("current") || joined.includes("value") || joined.includes("valuation");
  const hasName = joined.includes("scheme") || joined.includes("security") || joined.includes("company") || joined.includes("description") || joined.includes("scrip");
  return hasName && hasQuantity && hasValue;
}

function getCell(row: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (value) return value;
  }
  return undefined;
}

function inferAssetClass(name: string, row: Record<string, string> = {}): ImportedAssetClass {
  const haystack = `${name} ${Object.values(row).join(" ")}`;
  if (/scheme|fund|growth|idcw|direct|regular|nav/i.test(haystack)) return "MUTUAL_FUND";
  return "STOCK";
}

// CAS statements interleave holdings with footnotes, section headers, page
// markers, and running totals. Any of these phrases marks a line/name that is
// not a holding.
export const JUNK_TEXT_RE = new RegExp(
  [
    "sub\\s*total",
    "grand\\s*total",
    "opening\\s+balance",
    "closing\\s+balance",
    "^[-\\s]*page\\b",
    "page\\s+\\d+\\s+of\\s+\\d+",
    "statement\\s+for\\s+the\\s+period",
    "transaction\\s+statement",
    "consolidated\\s+account\\s+statement",
    "fundamental\\s+attributes?",
    "has\\s+been\\s+(?:changed|renamed|merged)",
    "mutual\\s+funds?\\s+folios?",
    "mutual\\s+funds?\\s*\\([a-z]\\)",
    "due\\s+to\\s+change",
    "\\bnomination\\b",
    "\\bkyc\\b",
    "registered\\s+office",
    "\\bdisclaimer\\b",
    "please\\s+note",
    "this\\s+statement",
  ].join("|"),
  "i",
);

// Per-unit plausibility for Indian retail CAS holdings: MF NAVs run ~₹10 to a
// few thousand (highest real NAVs are ~₹4k), equities up to ~₹1.5L (MRF);
// anything outside is a mis-parse.
const HOLDING_BOUNDS: Record<ImportedAssetClass, { maxQuantity: number; minPrice: number; maxPrice: number }> = {
  MUTUAL_FUND: { maxQuantity: 1_000_000, minPrice: 1, maxPrice: 25_000 },
  STOCK: { maxQuantity: 10_000_000, minPrice: 0.05, maxPrice: 1_000_000 },
};
const MAX_HOLDING_VALUE = 1_000_000_000; // ₹100 crore per single retail holding

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

interface NumToken {
  n: number;
  decimals: number;
  intDigits: number;
}

function numericTokens(line: string): NumToken[] {
  const out: NumToken[] = [];
  for (const m of line.matchAll(/(?:₹\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)/g)) {
    const raw = m[1];
    const n = money(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    const [intPart, decPart] = raw.split(".");
    out.push({
      n,
      decimals: decPart?.length ?? 0,
      intDigits: intPart.replace(/,/g, "").length,
    });
  }
  return out;
}

export function normalizeFolio(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, "").replace(/[^A-Z0-9/.-]+/gi, "").replace(/\/$/, "");
  const zeroSuffix = cleaned.match(/^(.+)\/0+$/);
  return (zeroSuffix ? zeroSuffix[1] : cleaned) || null;
}

function parseCasDate(value: string): string | null {
  const match = value.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

/** KFintech prints some scheme names in capitals; show them in title case like the rest. */
function titleCaseIfShouting(name: string): string {
  if (name !== name.toUpperCase() || !/[A-Z]{4}/.test(name)) return name;
  const keep = new Set(["IDCW", "ETF", "FOF", "PSU", "SBI", "HDFC", "ICICI", "DSP", "UTI", "LIC", "IT", "NPS", "II", "III"]);
  return name.toLowerCase().replace(/\b([a-z][a-z']*)\b/g, (word) =>
    keep.has(word.toUpperCase()) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1));
}

function cleanSchemeName(raw: string): string {
  return titleCaseIfShouting(raw
    .replace(/\b[A-Z0-9]{1,12}\s*-\s*/i, "")
    .replace(/\s*\((?:Non\s*-?\s*Demat|Non\s+Demat|Demat)\s*\).*$/i, "")
    .replace(/\s*\((?:formerly|erstwhile)[^)]+\)/ig, "")
    .replace(/\s+[-–]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^quant\b/i, "Quant"));
}

function holderNameAfter(lines: string[], folioLineIndex: number): string | null {
  for (const line of lines.slice(folioLineIndex + 1, folioLineIndex + 8)) {
    const compact = line.trim();
    if (!compact) continue;
    if (/^(nominee|opening unit balance|date\b|pan:|kyc:|registrar\b)/i.test(compact)) continue;
    if (/\*{3}|folio\s+no|isin:|advisor:|mutual\s+fund$/i.test(compact)) continue;
    return compact.replace(/\s+/g, " ");
  }
  return null;
}

const PAGE_MARKER = /^--- PAGE \d+ ---$/;
const PAGE_HEADING = /^Consolidated Account Statement$/i;
const SECTION_BODY = /Closing\s+Unit\s+Balance|^\d{2}-[A-Za-z]{3}\s*-?\s*\d{4}\b/;

/**
 * KFintech CAS PDFs extract each page's heading block (statement title, period, fund house and,
 * when a scheme starts at the top of the page, that scheme's header and folio) AFTER the page
 * body. A scheme beginning at a page top then has its transactions and closing balance ahead of
 * its own header, and the section parser misses it. Move a trailing heading block back to the top
 * of its page. Pages whose heading already comes first (CAMS) are left untouched.
 */
export function restorePageHeadings(lines: string[]): string[] {
  const out: string[] = [];
  let page: string[] = [];
  const flush = () => {
    const heading = page.findLastIndex((line) => PAGE_HEADING.test(line));
    const bodyBefore = heading > 0 && page.slice(0, heading).some((line) => SECTION_BODY.test(line));
    if (bodyBefore) {
      const markerAtStart = PAGE_MARKER.test(page[0] ?? "") ? 1 : 0;
      page = [...page.slice(0, markerAtStart), ...page.slice(heading), ...page.slice(markerAtStart, heading)];
    }
    out.push(...page);
    page = [];
  };
  for (const line of lines) {
    if (PAGE_MARKER.test(line)) flush();
    page.push(line);
  }
  flush();
  return out;
}

/** "P1191 -ICICI Prudential ..." / "HPREG-HDFC ...": a scheme code, then the scheme name. */
const SCHEME_CODE_START = /^[A-Z0-9]{1,12}\s*-\s*\S/;

/**
 * PDF text wraps long scheme headers. Two wraps break the section parser: an ISIN split across
 * lines ("ISIN: INF109K012" / "K1(Advisor..."), and a scheme name that starts on the line above
 * its ISIN line. Rejoin the ISIN first so every header carries a complete 12-character ISIN.
 */
export function joinWrappedIsins(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const partial = line.match(/\bISIN\s*:\s*(IN[A-Z0-9]{0,9})$/i);
    const next = lines[i + 1];
    if (partial && next) {
      const needed = 12 - partial[1].length;
      const rest = next.match(new RegExp(`^([A-Z0-9]{${needed}})(?![A-Z0-9])`, "i"));
      if (rest) {
        out.push(line + rest[1] + next.slice(rest[1].length));
        i++;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

function isSchemeHeaderLine(line: string): boolean {
  return /\bIN[A-Z0-9]{9}\s?[A-Z0-9]\b/i.test(line) && /\bISIN\s*:/i.test(line);
}

function nextSchemeHeaderIndex(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    if (isSchemeHeaderLine(lines[i])) return i;
  }
  return lines.length;
}

/**
 * CAMS/KFintech CAS PDFs represent each live fund as a section, not as a flat
 * row. The reliable fields are split across the section header, Folio line,
 * NAV/market value line, and Closing Unit Balance line. This parser keys on the
 * section ISIN plus folio, so multiple schemes under one folio and the same
 * ISIN under multiple folios are preserved as separate holdings.
 */
export function parseCamsKfintechFundSections(text: string): ParsedHoldingRow[] {
  const lines = joinWrappedIsins(restorePageHeadings(
    text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean),
  ));
  const rows: ParsedHoldingRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isSchemeHeaderLine(line)) continue;
    // Take the code after "ISIN:". KFintech prints the advisor/broker code first, and a SEBI
    // registration such as "INZ000305337" (a broker) or "INA..." (an adviser) is also IN + 10.
    const isin = (line.match(/\bISIN\s*:\s*(IN[A-Z0-9]{9}\s?[A-Z0-9])\b/i)?.[1]
      ?? line.match(/\b(IN[A-Z0-9]{9}\s?[A-Z0-9])\b/i)?.[1])?.replace(/\s+/g, "").toUpperCase();
    if (!isin || !/^INF/.test(isin)) continue;

    const beforeIsinOnLine = line.split(/\bISIN\s*:/i)[0] ?? "";
    const previous = lines[i - 1] ?? "";
    // The name continues from the line above when this line has no scheme code of its own and
    // the line above starts one (and is not itself a complete header).
    const continuesPrevious = !SCHEME_CODE_START.test(beforeIsinOnLine.trim())
      && SCHEME_CODE_START.test(previous) && !isSchemeHeaderLine(previous);
    const header = continuesPrevious
      || /^[-(]?\s*(?:Non\s*)?-?\s*Demat\b/i.test(beforeIsinOnLine)
      || !/fund|scheme|growth|idcw|regular|direct/i.test(beforeIsinOnLine)
      ? `${previous} ${line}`
      : line;
    const nameBeforeIsin = header.split(/\bISIN\s*:/i)[0] ?? "";
    const name = cleanSchemeName(nameBeforeIsin);
    if (!name || JUNK_TEXT_RE.test(name)) continue;

    const end = nextSchemeHeaderIndex(lines, i + 1);
    const section = lines.slice(i, end);
    const folioLineIndex = section.findIndex((sectionLine) => /folio\s+no\s*:/i.test(sectionLine));
    // "7933973 / 38" — stop at the folio and its optional "/ suffix"; KFintech continues the same
    // line with "KYC : OK PAN : OK", which a looser pattern would absorb into the folio.
    const folioMatch = folioLineIndex >= 0
      ? section[folioLineIndex].match(/folio\s+no\s*:\s*([A-Z0-9.-]+(?:\s*\/\s*[A-Z0-9.-]+)?)/i)
      : null;
    const folio = normalizeFolio(folioMatch?.[1] ?? null);
    if (!folio) continue;

    const holderName = holderNameAfter(section, folioLineIndex);
    const navLine = section.find((sectionLine) => /NAV\s+on\s+/i.test(sectionLine) && /Market\s+Value\s+on/i.test(sectionLine));
    const closingLine = section.find((sectionLine) => /Closing\s+Unit\s+Balance\s*:/i.test(sectionLine) && /Total\s+Cost\s+Value\s*:/i.test(sectionLine));
    if (!navLine || !closingLine) continue;

    const navMatch = navLine.match(/NAV\s+on\s+([^:]+):\s*INR\s*([0-9,.]+).*?Market\s+Value\s+on\s+[^:]+:\s*INR\s*([0-9,.]+)/i);
    // CAMS prints "Total Cost Value: 114,281.68"; KFintech prints "Total Cost Value : INR 6,74,000.00".
    const closingMatch = closingLine.match(/Closing\s+Unit\s+Balance\s*:\s*([0-9,.]+).*?Total\s+Cost\s+Value\s*:\s*(?:INR\s*)?([0-9,.]+)/i);
    if (!navMatch || !closingMatch) continue;

    const price = money(navMatch[2]);
    const value = money(navMatch[3]);
    const quantity = money(closingMatch[1]);
    const costValue = money(closingMatch[2]);
    if (![price, value, quantity, costValue].every((n) => Number.isFinite(n) && n >= 0)) continue;
    if (quantity <= 0 || value <= 0) continue;

    rows.push({
      name,
      folio,
      isin,
      quantity,
      price,
      value,
      costValue,
      asOfDate: parseCasDate(navMatch[1]),
      holderName,
      assetClass: "MUTUAL_FUND",
    });
  }

  return rows;
}

/**
 * From a line's numeric tokens, pick (quantity, price, value) such that
 * quantity × price ≈ value. Folio numbers, dates, and concatenated digits
 * never satisfy the cross-check, so a line with no consistent triple (or
 * consistent pair) is rejected outright instead of guessed at.
 */
function pickHoldingNumbers(
  tokens: NumToken[],
  assetClass: ImportedAssetClass,
): { quantity: number; price: number; value: number } | null {
  const b = HOLDING_BOUNDS[assetClass];
  // Folio numbers and other identifiers print as long undecimaled integers.
  const toks = tokens.filter((t) => t.n > 0 && !(t.decimals === 0 && t.intDigits >= 8));
  let best: { quantity: number; price: number; value: number; score: number } | null = null;
  for (let k = 0; k < toks.length; k++) {
    const value = toks[k].n;
    if (value > MAX_HOLDING_VALUE) continue;
    for (let i = 0; i < toks.length; i++) {
      if (i === k) continue;
      const quantity = toks[i].n;
      if (quantity > b.maxQuantity) continue;
      for (let j = 0; j < toks.length; j++) {
        if (j === k || j === i) continue;
        const price = toks[j].n;
        if (price < b.minPrice || price > b.maxPrice) continue;
        if (Math.abs(quantity * price - value) / value > 0.02) continue;
        // Prefer the rightmost value column (current value comes after cost
        // value in CAS layouts) and unit-style decimals for the quantity
        // (units print with 3+ decimals, NAV/price with 2).
        const score = k * 100 + (toks[i].decimals >= 3 ? 10 : 0) + (toks[j].decimals === 2 ? 1 : 0);
        if (!best || score > best.score) best = { quantity, price, value, score };
      }
    }
  }
  if (best) return { quantity: best.quantity, price: best.price, value: best.value };

  // Quantity + value with no printed price: accept only if the implied
  // per-unit price is plausible for the asset class.
  if (toks.length === 2) {
    const orders = [
      [toks[0], toks[1]],
      [toks[1], toks[0]],
    ].filter(([q, v]) => {
      const implied = v.n / q.n;
      return q.n <= b.maxQuantity && v.n <= MAX_HOLDING_VALUE && implied >= b.minPrice && implied <= b.maxPrice;
    });
    if (orders.length === 0) return null;
    const [q, v] = orders.length === 2 && orders[1][0].decimals >= 3 && orders[0][0].decimals < 3
      ? orders[1]
      : orders[0];
    return { quantity: q.n, price: v.n / q.n, value: v.n };
  }
  return null;
}

/**
 * Final gate applied to every parsed row regardless of which parser produced
 * it: reject footnote/disclaimer names and implausible magnitudes, and repair
 * a price that contradicts quantity × price ≈ value.
 */
export function sanitizeParsedRow(row: ParsedHoldingRow): ParsedHoldingRow | null {
  if (JUNK_TEXT_RE.test(row.name)) return null;
  const b = HOLDING_BOUNDS[row.assetClass];
  if (!Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > b.maxQuantity) return null;
  if (!Number.isFinite(row.value) || row.value <= 0 || row.value > MAX_HOLDING_VALUE) return null;
  const implied = row.value / row.quantity;
  if (implied < b.minPrice || implied > b.maxPrice) return null;
  let price = row.price;
  if (
    price === null ||
    price < b.minPrice ||
    price > b.maxPrice ||
    Math.abs(price * row.quantity - row.value) / row.value > 0.25
  ) {
    price = implied;
  }
  return { ...row, price };
}

export function parseStructured(text: string): ParsedHoldingRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => looksLikeHeader(splitCsvLine(line)));
  if (headerIndex === -1) return [];
  const headers = splitCsvLine(lines[headerIndex]).map(normalizeHeader);
  const rows: ParsedHoldingRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitCsvLine(line);
    if (cells.length < 3) continue;
    const mapped: Record<string, string> = {};
    headers.forEach((header, index) => { mapped[header] = cells[index] ?? ""; });
    const name = getCell(mapped, [
      "scheme_name", "scheme", "fund_name", "mutual_fund", "security_name", "security", "company_name", "company", "scrip_name", "description", "name",
    ]);
    const quantity = money(getCell(mapped, ["units", "unit_balance", "closing_units", "balance_units", "quantity", "qty", "balance"]));
    const price = money(getCell(mapped, ["nav", "closing_nav", "current_nav", "price", "market_price", "rate", "closing_price"]));
    const value = money(getCell(mapped, ["market_value", "current_value", "valuation", "amount", "value", "holding_value"]));
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(value) || value <= 0) continue;
    const isin = getCell(mapped, ["isin", "isin_code"]) ?? null;
    rows.push({
      name,
      folio: getCell(mapped, ["folio", "folio_no", "folio_number"]) ?? null,
      isin,
      quantity,
      price: Number.isFinite(price) && price > 0 ? price : null,
      value,
      assetClass: inferAssetClass(name, mapped),
    });
  }
  return rows;
}

export function parseLooseText(text: string): ParsedHoldingRow[] {
  const rows: ParsedHoldingRow[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let currentName: string | null = null;
  let folio: string | null = null;
  let isin: string | null = null;

  for (const line of lines) {
    const folioMatch = line.match(/folio\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\/\-]+)/i);
    if (folioMatch) folio = folioMatch[1];
    const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/i);
    if (isinMatch) isin = isinMatch[1].toUpperCase();

    const isNameLine = /fund|scheme|regular|direct|growth|idcw|equity|limited|ltd\.?|bank|industries|finance|technolog/i.test(line)
      && !/folio|total|market value|current value|nav|units|quantity|isin/i.test(line)
      && !JUNK_TEXT_RE.test(line)
      && line.length > 5;
    if (isNameLine) currentName = line.replace(/^(scheme|security|company)\s*name\s*[:\-]?\s*/i, "").trim();

    const unitsMatch = line.match(/(?:units?|quantity|qty|balance)\s*[:\-]?\s*([0-9,.]+)/i);
    const priceMatch = line.match(/(?:nav|price|rate)\s*[:\-]?\s*₹?\s*([0-9,.]+)/i);
    const valueMatch = line.match(/(?:market\s*value|current\s*value|valuation|holding\s*value|value)\s*[:\-]?\s*₹?\s*([0-9,.]+)/i);

    if (currentName && unitsMatch && valueMatch) {
      const quantity = money(unitsMatch[1]);
      const price = priceMatch ? money(priceMatch[1]) : NaN;
      const value = money(valueMatch[1]);
      if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(value) && value > 0) {
        rows.push({
          name: currentName,
          folio,
          isin,
          quantity,
          price: Number.isFinite(price) && price > 0 ? price : null,
          value,
          assetClass: inferAssetClass(currentName),
        });
        currentName = null;
        isin = null;
      }
    }
  }
  return rows;
}

export function compactCasLines(text: string): string[] {
  const raw = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows: string[] = [];
  let current = "";
  for (const line of raw) {
    // A footnote/header/total line both is not a record and must not be glued
    // onto one — flush whatever is pending and drop the line.
    if (JUNK_TEXT_RE.test(line)) {
      if (current) rows.push(current);
      current = "";
      continue;
    }
    const startsRecord = /\bIN[A-Z0-9]{10}\b/i.test(line)
      || /scheme|fund|regular|direct|growth|idcw|limited|ltd\.?|bank|industries|finance|technolog/i.test(line);
    const hasNumericTail = (line.match(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/g) ?? []).length >= 2;
    if (current && startsRecord && hasNumericTail) {
      rows.push(current);
      current = line;
    } else if (!current) {
      current = line;
    } else if (startsRecord || hasNumericTail || /folio|isin|nav|unit|quantity|market value|current value/i.test(line)) {
      current = `${current} ${line}`;
    }
    if (current && (current.match(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/g) ?? []).length >= 4 && /\bIN[A-Z0-9]{10}\b/i.test(current)) {
      rows.push(current);
      current = "";
    }
  }
  if (current) rows.push(current);
  return rows;
}

export function parseIsinRows(text: string): ParsedHoldingRow[] {
  const rows: ParsedHoldingRow[] = [];
  for (const line of compactCasLines(text)) {
    const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/i);
    if (!isinMatch) continue;
    const isin = isinMatch[1].toUpperCase();
    const afterIsin = line.slice(line.indexOf(isinMatch[0]) + isinMatch[0].length).trim();
    const firstNumber = afterIsin.search(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/);
    const rawName = (firstNumber >= 0 ? afterIsin.slice(0, firstNumber) : afterIsin)
      .replace(/\b(equity|debt|mutual fund|demat|current|balance|free|pledge|locked|value)\b/ig, " ")
      .replace(/\s+/g, " ")
      .trim();
    const name = rawName.length >= 3 ? rawName : `CAS Holding ${isin}`;
    const assetClass = inferAssetClass(name);
    const picked = pickHoldingNumbers(numericTokens(afterIsin), assetClass);
    if (!picked) continue;
    rows.push({
      name,
      folio: null,
      isin,
      quantity: picked.quantity,
      price: picked.price,
      value: picked.value,
      assetClass,
    });
  }
  return rows;
}

export function parseNumericTailRows(text: string): ParsedHoldingRow[] {
  const rows: ParsedHoldingRow[] = [];
  for (const line of compactCasLines(text)) {
    if (/\bIN[A-Z0-9]{10}\b/i.test(line)) continue;
    if (!/scheme|fund|regular|direct|growth|idcw|limited|ltd\.?|bank|industries|finance|technolog/i.test(line)) continue;
    const numbers = numericTokens(line);
    if (numbers.length < 2) continue;
    const firstNumber = line.search(/(?:₹\s*)?[0-9][0-9,.]*(?:\.\d+)?/);
    if (firstNumber < 4) continue;
    const name = line.slice(0, firstNumber)
      .replace(/^(scheme|security|company|scrip)\s*name\s*[:\-]?\s*/i, "")
      .replace(/\bfolio\b.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (name.length < 4) continue;
    const assetClass = inferAssetClass(name);
    const picked = pickHoldingNumbers(numbers, assetClass);
    if (!picked) continue;
    rows.push({
      name,
      folio: line.match(/folio\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\/\-]+)/i)?.[1] ?? null,
      isin: null,
      quantity: picked.quantity,
      price: picked.price,
      value: picked.value,
      assetClass,
    });
  }
  return rows;
}

/** All parsing strategies + sanity gate + dedupe, in one call. */
export function parseCasHoldings(text: string): ParsedHoldingRow[] {
  const sectionRows = parseCamsKfintechFundSections(text);
  // A CAMS/KFintech statement lists mutual-fund folios only. Once its sections parse, the loose
  // heuristics only turn boilerplate (load structures, "Folio No:", FATCA notices) into bogus
  // holdings, so they run only for formats the section parser does not recognise.
  const heuristicRows = sectionRows.length > 0 ? [] : parseStructured(text)
    .concat(parseLooseText(text), parseIsinRows(text), parseNumericTailRows(text));
  const parsed = sectionRows.concat(heuristicRows)
    .map(sanitizeParsedRow)
    .filter((row): row is ParsedHoldingRow => row !== null);
  const byKey = new Map<string, ParsedHoldingRow>();
  for (const row of parsed) {
    const key = `${row.assetClass}:${row.isin ?? row.name}:${normalizeFolio(row.folio) ?? ""}`;
    const previous = byKey.get(key);
    if (!previous || (row.costValue !== undefined && previous.costValue === undefined)) byKey.set(key, { ...row, folio: normalizeFolio(row.folio) });
  }
  return [...byKey.values()];
}
