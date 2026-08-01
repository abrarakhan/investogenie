const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{10}$/;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function normalizeIsin(value) {
  const normalized = clean(value).toUpperCase();
  return ISIN_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeAmc(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\b(MUTUAL FUND|ASSET MANAGEMENT(?: COMPANY)?|AMC|MF|INDIA)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePortfolioName(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\b(DIRECT|REGULAR|PLAN|GROWTH|IDCW|DIVIDEND|PAYOUT|REINVEST(?:MENT)?|OPTION|BONUS)\b/g, " ")
    .replace(/\b(DAILY|WEEKLY|FORTNIGHTLY|MONTHLY|QUARTERLY|HALF YEARLY|ANNUAL)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyPlanType(name) {
  if (/\bDIRECT\b/i.test(name)) return "DIRECT";
  if (/\bREGULAR\b/i.test(name)) return "REGULAR";
  return "OTHER";
}

export function classifyOptionType(name) {
  if (/\bGROWTH\b/i.test(name)) return "GROWTH";
  if (/\b(?:IDCW|DIVIDEND|PAYOUT|REINVEST(?:MENT)?)\b/i.test(name)) return "IDCW";
  if (/\bBONUS\b/i.test(name)) return "BONUS";
  return "OTHER";
}

export function parseAmfiSchemeMaster(text) {
  const rows = [];
  let category = null;
  let amc = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = clean(rawLine);
    if (!line) continue;
    if (!line.includes(";")) {
      if (/^(?:Open Ended|Close Ended|Interval Fund)/i.test(line)) {
        category = line;
        amc = null;
      } else if (/Mutual Fund$/i.test(line)) {
        amc = line;
      }
      continue;
    }

    const parts = line.split(";").map(clean);
    if (parts.length < 6 || !/^\d+$/.test(parts[0])) continue;
    const [amfiCode, payoutOrGrowthRaw, reinvestmentRaw, schemeName, navRaw, navDateRaw] = parts;
    const nav = Number(navRaw);
    const dateMatch = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(navDateRaw);
    if (!schemeName || !Number.isFinite(nav) || !dateMatch) continue;
    const navDate = new Date(`${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]} 00:00:00 UTC`);
    if (Number.isNaN(navDate.getTime())) continue;
    const portfolioName = normalizePortfolioName(schemeName);
    const amcKey = normalizeAmc(amc);

    rows.push({
      amfiCode,
      schemeName,
      amc,
      schemeCategory: category,
      portfolioKey: `${amcKey}|${portfolioName}`,
      isinPayoutOrGrowth: normalizeIsin(payoutOrGrowthRaw),
      isinReinvestment: normalizeIsin(reinvestmentRaw),
      planType: classifyPlanType(schemeName),
      optionType: classifyOptionType(schemeName),
      nav,
      navDate: navDate.toISOString().slice(0, 10),
    });
  }
  return rows;
}

function commonPrefixLength(a, b) {
  const max = Math.min(4, a.length, b.length);
  let count = 0;
  while (count < max && a[count] === b[count]) count += 1;
  return count;
}

export function jaroWinkler(aRaw, bRaw) {
  const a = normalizePortfolioName(aRaw);
  const b = normalizePortfolioName(bRaw);
  if (a === b) return 1;
  if (!a || !b) return 0;
  const distance = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - distance);
    const end = Math.min(i + distance + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  return jaro + commonPrefixLength(a, b) * 0.1 * (1 - jaro);
}

const rowIsins = (row) => [row.isinPayoutOrGrowth, row.isinReinvestment].filter(Boolean);

export function resolveSchemeFamilies(records, schemes) {
  const families = new Map();
  for (const row of records) {
    const family = families.get(row.portfolioKey) ?? [];
    family.push(row);
    families.set(row.portfolioKey, family);
  }

  const resolved = new Map();
  for (const scheme of schemes) {
    let familyKey = null;
    let method = null;
    const schemeIsin = normalizeIsin(scheme.isin);
    if (schemeIsin) {
      const exact = records.find((row) => rowIsins(row).includes(schemeIsin));
      if (exact) {
        familyKey = exact.portfolioKey;
        method = "existing_isin";
      }
    }

    if (!familyKey) {
      const amcKey = normalizeAmc(scheme.amc);
      const nameKey = normalizePortfolioName(scheme.name);
      const exactName = [...families.entries()].filter(([, rows]) => {
        const first = rows[0];
        return (!amcKey || normalizeAmc(first.amc) === amcKey) && normalizePortfolioName(first.schemeName) === nameKey;
      });
      if (exactName.length === 1) {
        familyKey = exactName[0][0];
        method = "normalized_name";
      }
    }

    if (!familyKey) {
      const amcKey = normalizeAmc(scheme.amc);
      const ranked = [...families.entries()]
        .filter(([, rows]) => !amcKey || normalizeAmc(rows[0].amc) === amcKey)
        .map(([key, rows]) => ({ key, score: jaroWinkler(scheme.name, rows[0].schemeName) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.score >= 0.94 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.025)) {
        familyKey = ranked[0].key;
        method = "high_confidence_name";
      }
    }

    if (familyKey) resolved.set(scheme.schemeCode, { method, records: families.get(familyKey) ?? [] });
  }
  return resolved;
}
