import { describe, expect, it } from "vitest";
import { advanceRecoveryAlertState, buildRecoveryTransitionAlerts } from "@/lib/tradeRecoveryAlerts";

const baseTrade = {
  id: "trade-dhampur-1",
  market: "IN" as const,
  ticker: "DHAMPURSUG",
  status: "OPEN" as const,
};

const emptyFreshSetup = {
  status: "NONE" as const,
  engine: null,
  label: null,
  entry: null,
  stop: null,
  target: null,
  route: null,
  blocker: null,
  firstQualifiedAt: null,
};

describe("buildRecoveryTransitionAlerts", () => {
  it("emits REBOUND_DETECTED once and suppresses repeats and UNVERIFIED blips", () => {
    const first = buildRecoveryTransitionAlerts(
      {
        ...baseTrade,
        recovery: {
          status: "REBOUND_DETECTED",
          headline: "Recovery detected · Up 19.2% over two sessions · Stop not reclaimed",
          move2dPct: 19.2,
          volumePace: 2.1,
          relativeStrength20d: 4.5,
          sectorThrustGroup: "Sugar & Ethanol (ACTIVE)",
          relatedNews: [],
          firstDetectedAt: "2026-11-26T09:15:00Z",
          evaluatedAt: "2026-11-26T09:15:00Z",
          freshSetup: {
            ...emptyFreshSetup,
            status: "BLOCKED",
            blocker: "Strong Swing: regime",
          },
        },
      },
      { lastAlertedRecoveryStatus: null, lastAlertedFreshSetupKey: null },
    );

    expect(first.alerts).toHaveLength(1);
    expect(first.alerts[0].transitionType).toBe("REBOUND_DETECTED");
    expect(first.alerts[0].signature).toBe("TRADE_RECOVERY|trade-dhampur-1|REBOUND_DETECTED");
    expect(first.nextRecoveryStatus).toBe("REBOUND_DETECTED");
    expect(first.nextFreshSetupKey).toBeNull();
    expect(first.alerts[0].pushBody).not.toContain("DHAMPURSUG");
    expect(first.alerts[0].pushBody).not.toContain("181.8");

    // Repeated quote tick with higher move% does not re-fire
    const repeat = buildRecoveryTransitionAlerts(
      {
        ...baseTrade,
        recovery: {
          status: "REBOUND_DETECTED",
          headline: "Recovery detected · Up 21.0% over two sessions · Stop not reclaimed",
          move2dPct: 21.0,
          volumePace: 2.4,
          relativeStrength20d: 5.1,
          sectorThrustGroup: "Sugar & Ethanol (ACTIVE)",
          relatedNews: [],
          firstDetectedAt: "2026-11-26T09:15:00Z",
          evaluatedAt: "2026-11-26T09:20:00Z",
          freshSetup: emptyFreshSetup,
        },
      },
      { lastAlertedRecoveryStatus: first.nextRecoveryStatus, lastAlertedFreshSetupKey: first.nextFreshSetupKey },
    );
    expect(repeat.alerts).toHaveLength(0);
    expect(repeat.stateChanged).toBe(false);

    // Transient UNVERIFIED quote preserves prior dedup state
    const unverified = buildRecoveryTransitionAlerts(
      {
        ...baseTrade,
        recovery: {
          status: "UNVERIFIED",
          headline: "Recovery status unverified · Awaiting fresh quote",
          move2dPct: null,
          volumePace: null,
          relativeStrength20d: null,
          sectorThrustGroup: null,
          relatedNews: [],
          firstDetectedAt: "2026-11-26T09:15:00Z",
          evaluatedAt: "2026-11-26T09:30:00Z",
          freshSetup: emptyFreshSetup,
        },
      },
      { lastAlertedRecoveryStatus: repeat.nextRecoveryStatus, lastAlertedFreshSetupKey: repeat.nextFreshSetupKey },
    );
    expect(unverified.alerts).toHaveLength(0);
    expect(unverified.nextRecoveryStatus).toBe("REBOUND_DETECTED");
  });

  it("emits STOP_RECLAIMED and FRESH_SETUP_QUALIFIED once per transition and supports engine upgrade", () => {
    const reclaimedAndQualified = buildRecoveryTransitionAlerts(
      {
        ...baseTrade,
        recovery: {
          status: "STOP_RECLAIMED",
          headline: "Stop reclaimed · Back above ₹191.59 frozen stop",
          move2dPct: 22.4,
          volumePace: 2.5,
          relativeStrength20d: 6.2,
          sectorThrustGroup: "Sugar & Ethanol (ACTIVE)",
          relatedNews: [],
          firstDetectedAt: "2026-11-26T09:15:00Z",
          evaluatedAt: "2026-11-27T09:45:00Z",
          freshSetup: {
            status: "QUALIFIED",
            engine: "SWING_BREAKOUT",
            label: "Swing Breakout (score 75/100)",
            entry: 180.01,
            stop: null,
            target: null,
            route: "/terminal/in/screener",
            blocker: null,
            firstQualifiedAt: "2026-11-27T09:45:00Z",
          },
        },
      },
      { lastAlertedRecoveryStatus: "REBOUND_DETECTED", lastAlertedFreshSetupKey: null },
    );

    expect(reclaimedAndQualified.alerts).toHaveLength(2);
    expect(reclaimedAndQualified.alerts[0].transitionType).toBe("STOP_RECLAIMED");
    expect(reclaimedAndQualified.alerts[1].transitionType).toBe("FRESH_SETUP_QUALIFIED");
    expect(reclaimedAndQualified.alerts[1].signature).toBe("TRADE_RECOVERY_SETUP|trade-dhampur-1|SWING_BREAKOUT");
    expect(reclaimedAndQualified.nextRecoveryStatus).toBe("STOP_RECLAIMED");
    expect(reclaimedAndQualified.nextFreshSetupKey).toBe("QUALIFIED:SWING_BREAKOUT");

    // Upgrade to STRONG_SWING fires once for the new engine, not again for STOP_RECLAIMED
    const upgraded = buildRecoveryTransitionAlerts(
      {
        ...baseTrade,
        recovery: {
          status: "STOP_RECLAIMED",
          headline: "Stop reclaimed · Back above ₹191.59 frozen stop",
          move2dPct: 24.0,
          volumePace: 2.7,
          relativeStrength20d: 8.1,
          sectorThrustGroup: "Sugar & Ethanol (ACTIVE)",
          relatedNews: [],
          firstDetectedAt: "2026-11-26T09:15:00Z",
          evaluatedAt: "2026-11-28T09:45:00Z",
          freshSetup: {
            status: "QUALIFIED",
            engine: "STRONG_SWING",
            label: "Strong Swing · Execution Ready (score 84)",
            entry: 194.0,
            stop: 182.0,
            target: 218.0,
            route: "/terminal/in/strong-swing",
            blocker: null,
            firstQualifiedAt: "2026-11-27T09:45:00Z",
          },
        },
      },
      {
        lastAlertedRecoveryStatus: reclaimedAndQualified.nextRecoveryStatus,
        lastAlertedFreshSetupKey: reclaimedAndQualified.nextFreshSetupKey,
      },
    );
    expect(upgraded.alerts).toHaveLength(1);
    expect(upgraded.alerts[0].transitionType).toBe("FRESH_SETUP_QUALIFIED");
    expect(upgraded.alerts[0].signature).toBe("TRADE_RECOVERY_SETUP|trade-dhampur-1|STRONG_SWING");
  });

  it("does not advance dedup state for failed claims so the next poll can retry", () => {
    const prev = { lastAlertedRecoveryStatus: "REBOUND_DETECTED", lastAlertedFreshSetupKey: null };
    const noneClaimed = advanceRecoveryAlertState(prev, []);
    expect(noneClaimed.stateChanged).toBe(false);
    expect(noneClaimed.lastAlertedRecoveryStatus).toBe("REBOUND_DETECTED");
    expect(noneClaimed.lastAlertedFreshSetupKey).toBeNull();

    // Only STOP_RECLAIMED succeeded; FRESH_SETUP_QUALIFIED failed and stays null for retry
    const partial = advanceRecoveryAlertState(prev, [
      { transitionType: "STOP_RECLAIMED", freshSetupKey: null },
    ]);
    expect(partial.stateChanged).toBe(true);
    expect(partial.lastAlertedRecoveryStatus).toBe("STOP_RECLAIMED");
    expect(partial.lastAlertedFreshSetupKey).toBeNull();
  });
});
