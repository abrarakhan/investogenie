import { createHash } from "node:crypto";
import type { NormalizedNewsArticle } from "./providers";

const TRUSTED: Record<string, number> = {
  "rbi.org.in": 100, "sebi.gov.in": 100, "nseindia.com": 100, "bseindia.com": 100,
  "federalreserve.gov": 100, "reuters.com": 98, "bloomberg.com": 98, "ft.com": 95,
  "wsj.com": 94, "cnbc.com": 90, "economictimes.indiatimes.com": 88,
  "livemint.com": 88, "business-standard.com": 88,
};

export function canonicalizeNewsUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    });
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return raw.trim();
  }
}

export function newsDomain(raw: string): string {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function sourceTrustScore(url: string): number {
  const domain = newsDomain(url);
  const match = Object.entries(TRUSTED).find(([trusted]) => domain === trusted || domain.endsWith(`.${trusted}`));
  return match?.[1] ?? 40;
}

export function storyFingerprint(title: string): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|a|an|and|or|of|to|in|on|for|with)\b/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function enrichEvidence(articles: NormalizedNewsArticle[]): NormalizedNewsArticle[] {
  const groups = new Map<string, Set<string>>();
  for (const article of articles) {
    const key = storyFingerprint(article.title);
    const domains = groups.get(key) ?? new Set<string>();
    domains.add(newsDomain(article.url));
    groups.set(key, domains);
    const similar = (article.rawPayload as { similar?: Array<{ url?: string }> } | null)?.similar ?? [];
    for (const item of similar) {
      const domain = newsDomain(item.url ?? "");
      if (domain) domains.add(domain);
    }
  }
  return articles.map((article) => {
    const contentFingerprint = storyFingerprint(article.title);
    const trustScore = sourceTrustScore(article.url);
    const corroborationCount = groups.get(contentFingerprint)?.size ?? 1;
    const canonicalUrl = canonicalizeNewsUrl(article.url);
    return {
      ...article, url: canonicalUrl, canonicalUrl, contentFingerprint,
      eventClusterKey: contentFingerprint, trustScore, corroborationCount,
      verifiedEvidence: trustScore >= 99 || (trustScore >= 85 && corroborationCount >= 2),
    };
  });
}
