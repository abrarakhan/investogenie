import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "investogenie.mobile.token";
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const API_URL = (configuredApiUrl || "http://localhost:3000").replace(/\/$/, "");

export function apiConfigurationError(): string | null {
  if (!configuredApiUrl && !__DEV__) return "This build has no InvestoGenie server configured.";
  if (!/^https:\/\//.test(API_URL) && !__DEV__) return "Production builds require an HTTPS InvestoGenie server.";
  return null;
}

export type Market = "IN" | "US";

export interface MobileUser { id: string; email: string }

export interface StrongCandidate {
  assetId: string;
  ticker: string;
  exchange?: string | null;
  status: "EXECUTION_READY" | "WAIT_FOR_ENTRY" | "WATCHLIST" | "RISK_OFF" | "INVALIDATED";
  strengthScore: number;
  strongSwingRank: number;
  lastQuote: number | null;
  latestClose: number;
  latestDate: string;
  strongEntry: number;
  strongTarget: number;
  strongStop: number;
  strongTrail: number;
  strongExpectedDays: number;
  fiveDayReturnPct: number | null;
  tenDayReturnPct: number | null;
  gates: Array<{ key: string; label: string; passed: boolean; detail: string }>;
}

export interface NewsEvidence {
  articleId: string;
  title: string;
  url: string;
  sourceName: string | null;
  publishedAt: string;
  direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  rationale: string;
}

export interface NewsSwingCandidate extends StrongCandidate {
  technicalScore: number;
  newsAdjustment: number;
  combinedScore: number;
  state: "FAVORED" | "NEUTRAL" | "CAUTION" | "RISK_OFF";
  news: NewsEvidence[];
}

export interface LedgerTrade {
  id: string;
  assetId: string;
  ticker: string;
  assetName: string | null;
  exchange: string | null;
  status: "OPEN" | "CLOSED";
  boughtOn: string;
  buyPrice: number;
  quantity: number;
  remainingQuantity: number;
  currentPrice: number | null;
  quoteUpdatedAt: string | null;
  projectedTarget: number;
  projectedStop: number;
  effectiveTrailingStop: number | null;
  progress: {
    pnlValue: number | null;
    pnlPct: number | null;
    daysHeld: number;
    daysRemaining: number;
    remainingUpsidePct: number | null;
    state: string;
  };
  risk: { state: string; recommendation: string; reasons: string[] };
  exits: Array<{ id: string; soldOn: string; quantity: number; exitPrice: number; reason: string | null; realizedPnlValue: number }>;
}

export interface CandlePoint { date: string; open: number; high: number; low: number; close: number; volume: number | null }

export interface LedgerSummary {
  openCount: number;
  closedCount: number;
  openInvestedValue: number;
  unrealizedPnlValue: number;
  realizedPnlValue: number;
  overallPnlValue: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const configurationError = apiConfigurationError();
  if (configurationError) throw new Error(configurationError);
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload as T;
}

export async function restoreSession(): Promise<MobileUser | null> {
  if (!(await SecureStore.getItemAsync(TOKEN_KEY))) return null;
  try {
    const result = await request<{ user: MobileUser }>("/api/v1/mobile/me");
    return result.user;
  } catch {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return null;
  }
}

export async function login(email: string, password: string): Promise<MobileUser> {
  const result = await request<{ token: string; user: MobileUser }>("/api/v1/mobile/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, deviceName: "InvestoGenie Android/iOS" }),
  });
  await SecureStore.setItemAsync(TOKEN_KEY, result.token);
  return result.user;
}

export async function logout(): Promise<void> {
  try {
    await request("/api/v1/mobile/push-token", { method: "DELETE" }).catch(() => undefined);
    await request("/api/v1/mobile/auth/logout", { method: "DELETE" });
  } finally {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export function registerPushToken(token: string, platform: "android" | "ios") {
  return request<{ ok: true }>("/api/v1/mobile/push-token", {
    method: "POST", body: JSON.stringify({ token, platform }),
  });
}

export function getStrongSwing(market: Market) {
  return request<{ generatedAt: string; candidates: StrongCandidate[] }>(
    `/api/v1/mobile/strong-swing?market=${market}&limit=30`,
  );
}

export function getNewsSwing(market: Market) {
  return request<{
    generatedAt: string;
    lastFetchedAt: string | null;
    articleCount: number;
    impactCount: number;
    candidates: NewsSwingCandidate[];
  }>(`/api/v1/mobile/news-swing?market=${market}`);
}

export function getLedger(market: Market) {
  return request<{ generatedAt: string; summary: LedgerSummary; trades: LedgerTrade[] }>(
    `/api/v1/mobile/trade-ledger?market=${market}`,
  );
}

export function getCandles(market: Market, ticker: string) {
  return request<{ candle: { ticker: string; points: CandlePoint[] } | null }>(
    `/api/v1/mobile/candles?market=${market}&ticker=${encodeURIComponent(ticker)}&days=90`,
  );
}

export function createTrade(input: {
  assetId: string; market: Market; boughtOn: string; buyPrice: number; quantity: number;
  strategyKey: string; projectionEntry?: number; projectedTarget?: number; projectedStop?: number;
  projectedTrailingStop?: number; expectedHoldingDays?: number;
}) {
  return request<{ id: string }>("/api/v1/mobile/trade-ledger", { method: "POST", body: JSON.stringify(input) });
}

export function updateTrade(tradeId: string, input: {
  market: Market; boughtOn: string; buyPrice: number; quantity: number; notes?: string;
}) {
  return request<{ ok: true }>(`/api/v1/mobile/trade-ledger/${tradeId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteTrade(tradeId: string) {
  return request<void>(`/api/v1/mobile/trade-ledger/${tradeId}`, { method: "DELETE" });
}

export function recordSale(tradeId: string, input: {
  market: Market; soldOn: string; quantity: number; exitPrice: number; reason?: string;
}) {
  return request<{ ok: true }>(`/api/v1/mobile/trade-ledger/${tradeId}/sales`, { method: "POST", body: JSON.stringify(input) });
}

export function updateSale(tradeId: string, saleId: string, input: {
  market: Market; soldOn: string; quantity: number; exitPrice: number; reason?: string;
}) {
  return request<{ ok: true }>(`/api/v1/mobile/trade-ledger/${tradeId}/sales/${saleId}`, { method: "PATCH", body: JSON.stringify(input) });
}
