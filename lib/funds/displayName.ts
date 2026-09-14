import { inferAmc } from "./fundMapping";

const FUND_HOUSES: Array<{
  match: RegExp;
  name: string;
  schemePrefix: RegExp;
}> = [
  { match: /aditya birla|absl/i, name: "Aditya Birla Sun Life", schemePrefix: /^(?:aditya\s+birla\s+sun\s+life|absl)\s+/i },
  { match: /canara robeco/i, name: "Canara Robeco", schemePrefix: /^canara\s+robeco\s+/i },
  { match: /^dsp\b|\bdsp\s+mf\b/i, name: "DSP", schemePrefix: /^dsp\s+/i },
  { match: /franklin|templeton/i, name: "Franklin Templeton", schemePrefix: /^(?:franklin\s+templeton|franklin)\s+/i },
  { match: /^hdfc\b|\bhdfc\s+mf\b/i, name: "HDFC", schemePrefix: /^hdfc\s+/i },
  { match: /icici prudential/i, name: "ICICI Prudential", schemePrefix: /^icici\s+prudential\s+/i },
  { match: /motilal oswal/i, name: "Motilal Oswal", schemePrefix: /^motilal\s+oswal\s+/i },
  { match: /nippon india/i, name: "Nippon India", schemePrefix: /^nippon\s+india\s+/i },
  { match: /^quant\b|\bquant\s+mf\b/i, name: "Quant", schemePrefix: /^quant(?:\s+mutual\s+fund|\s+mf)?\s+/i },
  { match: /^sbi\b|\bsbi\s+mf\b/i, name: "SBI", schemePrefix: /^sbi\s+/i },
];

const SHARE_CLASS_SUFFIXES = [
  /\s*[-–|]?\s*growth\s+plan\s+growth\s+option\s*$/i,
  /\s*[-–|]?\s*(?:regular|direct)(?:\s+plan)?\s*[-–]?\s*(?:growth(?:\s+option)?|idcw(?:\s+(?:option|payout|reinvestment))?|dividend(?:\s+(?:option|payout|reinvestment))?)?\s*$/i,
  /\s*[-–|]?\s*(?:growth(?:\s+option)?|idcw(?:\s+(?:option|payout|reinvestment))?|dividend(?:\s+(?:option|payout|reinvestment))?)\s*$/i,
];

function cleanSchemeName(rawName: string, schemePrefix?: RegExp): string {
  let name = rawName.replace(/\s+/g, " ").trim();
  if (schemePrefix) name = name.replace(schemePrefix, "");
  name = name.replace(/^(?:mutual\s+fund|mf)\s*[-:|]?\s*/i, "");

  let previous = "";
  while (name !== previous) {
    previous = name;
    for (const suffix of SHARE_CLASS_SUFFIXES) name = name.replace(suffix, "");
    name = name.replace(/[\s\-|–:]+$/g, "").trim();
  }
  return name || rawName.trim();
}

export interface FundDisplayIdentity {
  amc: string;
  scheme: string;
  label: string;
}

/** Presentation-only identity. Raw CAS/AMFI names remain unchanged for matching and audit. */
export function fundDisplayIdentity(
  rawName: string,
  amc?: string | null,
  isin?: string | null,
): FundDisplayIdentity {
  const inferred = amc || inferAmc(rawName, isin) || "Mutual Fund";
  const house = FUND_HOUSES.find(({ match }) => match.test(`${inferred} ${rawName}`));
  const fundHouse = house?.name ?? inferred.replace(/\s+(?:mutual\s+fund|mf)$/i, "").trim();
  const scheme = cleanSchemeName(rawName, house?.schemePrefix);
  return { amc: fundHouse, scheme, label: `${fundHouse} · ${scheme}` };
}
