import type { SwingLedgerTrade } from "@/lib/swingTradeLedger";

export interface RecoveryAlertDedupState {
  lastAlertedRecoveryStatus: string | null;
  lastAlertedFreshSetupKey: string | null;
}

export interface RecoveryAlertCandidate {
  transitionType: "REBOUND_DETECTED" | "STOP_RECLAIMED" | "FRESH_SETUP_QUALIFIED";
  freshSetupKey: string | null;
  recommendation: string;
  signature: string;
  title: string;
  body: string;
  route: string;
  pushTitle: string;
  pushBody: string;
}

export interface RecoveryAlertEvaluation {
  alerts: RecoveryAlertCandidate[];
  nextRecoveryStatus: string | null;
  nextFreshSetupKey: string | null;
  stateChanged: boolean;
}

/**
 * Advance persisted dedup state ONLY for candidates whose browser-event claim succeeded
 * (inserted or already claimed via unique conflict). Any candidate whose DB insert failed
 * is omitted from `claimed`, keeping its slot unadvanced so the next poll retries it.
 */
export function advanceRecoveryAlertState(
  prev: RecoveryAlertDedupState,
  claimed: ReadonlyArray<Pick<RecoveryAlertCandidate, "transitionType" | "freshSetupKey">>,
): RecoveryAlertDedupState & { stateChanged: boolean } {
  let lastAlertedRecoveryStatus = prev.lastAlertedRecoveryStatus;
  let lastAlertedFreshSetupKey = prev.lastAlertedFreshSetupKey;
  for (const item of claimed) {
    if (item.transitionType === "REBOUND_DETECTED" || item.transitionType === "STOP_RECLAIMED") {
      lastAlertedRecoveryStatus = item.transitionType;
    } else if (item.transitionType === "FRESH_SETUP_QUALIFIED" && item.freshSetupKey) {
      lastAlertedFreshSetupKey = item.freshSetupKey;
    }
  }
  const stateChanged =
    lastAlertedRecoveryStatus !== prev.lastAlertedRecoveryStatus ||
    lastAlertedFreshSetupKey !== prev.lastAlertedFreshSetupKey;
  return { lastAlertedRecoveryStatus, lastAlertedFreshSetupKey, stateChanged };
}

/**
 * Pure transition-deduplication rules for Phase 3 Trade Recovery alerts.
 *
 * - Alerts at most once per meaningful state transition:
 *   1. REBOUND_DETECTED
 *   2. STOP_RECLAIMED
 *   3. FRESH_SETUP_QUALIFIED (<engine>)
 * - Never alerts on NONE, UNVERIFIED, or BLOCKED.
 * - Never resets dedup state on transient UNVERIFIED quote blips.
 * - Signatures never include live prices or percentages so quote ticks never re-fire alerts.
 * - Push payloads never include ticker names or financial figures.
 */
export function buildRecoveryTransitionAlerts(
  trade: Pick<SwingLedgerTrade, "id" | "market" | "ticker" | "status" | "recovery">,
  prev: RecoveryAlertDedupState,
): RecoveryAlertEvaluation {
  let nextRecoveryStatus = prev.lastAlertedRecoveryStatus;
  let nextFreshSetupKey = prev.lastAlertedFreshSetupKey;
  const alerts: RecoveryAlertCandidate[] = [];

  if (trade.status !== "OPEN" || !trade.recovery) {
    return { alerts, nextRecoveryStatus, nextFreshSetupKey, stateChanged: false };
  }

  const marketPath = trade.market.toLowerCase();
  const ledgerRoute = `/terminal/${marketPath}/trade-ledger`;
  const rec = trade.recovery;

  if (
    (rec.status === "REBOUND_DETECTED" || rec.status === "STOP_RECLAIMED") &&
    prev.lastAlertedRecoveryStatus !== rec.status
  ) {
    const isReclaimed = rec.status === "STOP_RECLAIMED";
    const thrustSuffix = rec.sectorThrustGroup ? ` · ${rec.sectorThrustGroup}` : "";
    const rawBody =
      (rec.headline ?? (isReclaimed ? `${trade.ticker} reclaimed its frozen stop.` : `${trade.ticker} recovery detected.`)) +
      thrustSuffix;

    alerts.push({
      transitionType: rec.status,
      freshSetupKey: null,
      recommendation: rec.status,
      signature: `TRADE_RECOVERY|${trade.id}|${rec.status}`,
      title: isReclaimed
        ? `InvestoGenie: Stop reclaimed · ${trade.ticker}`
        : `InvestoGenie: Recovery detected · ${trade.ticker}`,
      body: rawBody.slice(0, 220),
      route: ledgerRoute,
      pushTitle: isReclaimed ? "InvestoGenie: Stop reclaimed" : "InvestoGenie: Recovery detected",
      pushBody: isReclaimed
        ? "A previously breached open trade reclaimed its frozen stop. Open Trade Ledger to review."
        : "Fresh recovery evidence was detected on an open trade. Open Trade Ledger to review.",
    });
    nextRecoveryStatus = rec.status;
  }

  const fs = rec.freshSetup;
  if (fs && fs.status === "QUALIFIED" && fs.engine) {
    const freshKey = `QUALIFIED:${fs.engine}`;
    if (prev.lastAlertedFreshSetupKey !== freshKey) {
      const label = fs.label ?? fs.engine.replaceAll("_", " ");
      alerts.push({
        transitionType: "FRESH_SETUP_QUALIFIED",
        freshSetupKey: freshKey,
        recommendation: `FRESH_SETUP_${fs.engine}`,
        signature: `TRADE_RECOVERY_SETUP|${trade.id}|${fs.engine}`,
        title: `InvestoGenie: Fresh setup qualified · ${trade.ticker}`,
        body: `${label} qualified for recovering trade ${trade.ticker}. Original frozen plan unchanged.`.slice(0, 220),
        route: fs.route ?? ledgerRoute,
        pushTitle: "InvestoGenie: Fresh setup qualified",
        pushBody: "A recovering open trade qualified for a separate fresh setup. Open Trade Ledger to review.",
      });
      nextFreshSetupKey = freshKey;
    }
  }

  const stateChanged =
    nextRecoveryStatus !== prev.lastAlertedRecoveryStatus ||
    nextFreshSetupKey !== prev.lastAlertedFreshSetupKey;

  return { alerts, nextRecoveryStatus, nextFreshSetupKey, stateChanged };
}
