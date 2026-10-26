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
  /** Server-held execution plan for an EXECUTION_READY candidate; purchases reference it. */
  planId?: string | null;
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
  revisedPlan: {
    action: "FOLLOW_ORIGINAL" | "EXTEND_RUNNER" | "PROTECT_PROFIT" | "PROTECT_RECOVERY" | "EXIT" | "UNAVAILABLE";
    label: string;
    revisedTarget: number | null;
    protectiveStop: number | null;
    remainingUpsidePct: number | null;
    originalPlanBreached: boolean;
    atUpperCircuit: boolean;
    reasons: string[];
  };
  exits: Array<{ id: string; soldOn: string; quantity: number; exitPrice: number; saleValue: number; reason: string | null; realizedPnlValue: number }>;
}

export interface CandlePoint { date: string; open: number; high: number; low: number; close: number; volume: number | null }

export interface LedgerSummary {
  openCount: number;
  closedCount: number;
  openInvestedValue: number;
  unrealizedPnlValue: number;
  realizedPnlValue: number;
  overallPnlValue: number;
  totalInvestedValue: number;
  capitalEmployedValue: number;
  currentOpenValue: number;
  roiPct: number | null;
  xirrPct: number | null;
}

/** An HTTP error from the server, keeping the status so callers can tell 401 from an outage. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
  if (!response.ok) throw new ApiError(response.status, payload?.error || `Request failed (${response.status})`);
  return payload as T;
}

export async function restoreSession(): Promise<MobileUser | null> {
  if (!(await SecureStore.getItemAsync(TOKEN_KEY))) return null;
  try {
    const result = await request<{ user: MobileUser }>("/api/v1/mobile/me");
    return result.user;
  } catch (cause) {
    // Only a rejected token signs the user out. Offline or a server outage at launch must not
    // discard a valid session; rethrow so the app can offer a retry.
    if (cause instanceof ApiError && cause.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      return null;
    }
    throw cause;
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

/** A Strong Swing purchase sends only the plan id; the server reads every level from the plan. */
export function createTrade(input: {
  assetId: string; market: Market; boughtOn: string; buyPrice: number; quantity: number;
  strategyKey: "STRONG_SWING"; planId: string;
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

// ---- Server-driven screens -----------------------------------------------------------------
// Mirrors lib/mobileScreens.ts. The server computes and formats every value; the app renders
// these cards as-is, so new screens or fields ship without an Android or iOS release.

export type ScreenTone = "positive" | "negative" | "warning" | "neutral";

export interface ScreenCatalogEntry { key: string; title: string; tabLabel: string; kind: "native" | "cards" }

export interface ScreenCard {
  id: string;
  title: string;
  subtitle: string;
  badge: { label: string; tone: ScreenTone } | null;
  score: string | null;
  metrics: Array<{ label: string; value: string; tone?: ScreenTone }>;
  footer: string | null;
  chartTicker: string | null;
  guidance: string | null;
  sections: Array<{ title: string; rows: Array<{ label: string; value?: string; detail?: string; passed?: boolean }> }>;
}

export interface ScreenOption { param: string; label: string; value: string; choices: Array<{ value: string; label: string }> }

export interface MobileScreen {
  key: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  summary: string | null;
  notice: string | null;
  options: ScreenOption[];
  searchable: boolean;
  cards: ScreenCard[];
}

export function getScreenCatalog() {
  return request<{ screens: ScreenCatalogEntry[] }>("/api/v1/mobile/screens");
}

export function getScreen(key: string, market: Market, params: Record<string, string> = {}) {
  const query = new URLSearchParams({ ...params, market });
  return request<MobileScreen>(`/api/v1/mobile/screens/${encodeURIComponent(key)}?${query.toString()}`);
}
