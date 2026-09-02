export type NewsDirection = "POSITIVE" | "NEGATIVE" | "NEUTRAL";
export type NewsScope = "MARKET" | "SECTOR" | "ASSET";
export type NewsHorizon = "INTRADAY" | "SWING" | "MEDIUM_TERM";

export interface NewsImpactInput {
  direction: NewsDirection;
  sentimentScore: number;
  confidence: number;
  severity: number;
  publishedAt: string;
  scope: NewsScope;
}
export interface NewsSwingScore {
  technicalScore: number;
  newsAdjustment: number;
  combinedScore: number;
  state: "FAVORED" | "NEUTRAL" | "CAUTION" | "RISK_OFF";
}

/** Rank strongest actionable setups first while keeping explicit vetoes last. */
export function rankNewsSwingCandidates<T extends NewsSwingScore & { ticker: string }>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort((a, b) => {
    const aVetoed = a.state === "RISK_OFF" ? 1 : 0;
    const bVetoed = b.state === "RISK_OFF" ? 1 : 0;
    return aVetoed - bVetoed
      || b.combinedScore - a.combinedScore
      || b.newsAdjustment - a.newsAdjustment
      || b.technicalScore - a.technicalScore
      || a.ticker.localeCompare(b.ticker);
  });
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** News loses half its swing relevance every 24 hours and is ignored after 7 days. */
export function newsDecay(publishedAt: string, now = new Date()): number {
  const ageMs = now.getTime() - Date.parse(publishedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1;
  const ageHours = ageMs / 3_600_000;
  if (ageHours >= 168) return 0;
  return 0.5 ** (ageHours / 24);
}

/**
 * Add a bounded event overlay to the existing technical score. Positive news
 * can rank an existing setup higher, never create one. A high-confidence,
 * severe negative event is an explicit risk-off veto.
 */
export function scoreNewsSwing(
  rawTechnicalScore: number,
  impacts: NewsImpactInput[],
  now = new Date(),
): NewsSwingScore {
  const technicalScore = clamp(rawTechnicalScore <= 1 ? rawTechnicalScore * 100 : rawTechnicalScore, 0, 100);
  let weighted = 0;
  let riskOff = false;
  for (const impact of impacts) {
    const decay = newsDecay(impact.publishedAt, now);
    if (decay === 0) continue;
    const direction = impact.direction === "POSITIVE" ? 1 : impact.direction === "NEGATIVE" ? -1 : 0;
    const scopeWeight = impact.scope === "ASSET" ? 1 : impact.scope === "SECTOR" ? 0.75 : 0.6;
    weighted += direction * Math.abs(clamp(impact.sentimentScore, -1, 1))
      * clamp(impact.confidence, 0, 1) * clamp(impact.severity, 0, 1) * decay * scopeWeight * 20;
    if (
      impact.direction === "NEGATIVE"
      && impact.sentimentScore <= -0.65
      && impact.confidence >= 0.7
      && impact.severity >= 0.8
      && decay >= 0.35
    ) riskOff = true;
  }
  const newsAdjustment = Math.round(clamp(weighted, -20, 20) * 10) / 10;
  const combinedScore = Math.round(clamp(technicalScore + newsAdjustment, 0, 100) * 10) / 10;
  const state = riskOff
    ? "RISK_OFF"
    : newsAdjustment >= 4 ? "FAVORED"
      : newsAdjustment <= -4 ? "CAUTION" : "NEUTRAL";
  return { technicalScore, newsAdjustment, combinedScore, state };
}
