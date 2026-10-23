export const isMomentumExecutionReady = (status: string): boolean =>
  status === "ENTRY_READY" || status === "MOMENTUM_READY";
