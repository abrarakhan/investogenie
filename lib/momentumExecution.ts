// Stored execution plans carry this value. Bump it whenever entry eligibility
// changes so a plan captured by older logic cannot remain buyable after deploy.
export const MOMENTUM_EXECUTION_MODEL_VERSION = "episode-anchor-v1";

// Presentation and plan-persistence helper only. Python decides the status.
export const isMomentumExecutionReady = (status: string): boolean =>
  status === "ENTRY_READY" || status === "MOMENTUM_READY";
