import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface RecoveryTargetResult {
  recoveryTarget: number | null;
  historicalTarget: number | null;
  sampleSize: number;
  horizon: number;
}

export async function calculateRecoveryTargets(inputs: Array<{
  tradeId: string;
  assetId: string;
  market: "IN" | "US";
  cutoffDate: string;
  currentPrice: number;
  atr: number;
  move1dPct: number | null;
  move2dPct: number | null;
  horizon: number;
}>): Promise<Map<string, RecoveryTargetResult>> {
  if (!inputs.length) return new Map();
  const root = process.cwd();
  const python = process.env.PYTHON_BIN || [root, ".venv", "bin", "python"].join("/");
  const worker = [root, "workers", "trade_recovery_targets.py"].join("/");
  try {
    const { stdout } = await execute(python, [worker, JSON.stringify(inputs)], {
      cwd: root, timeout: 20_000, maxBuffer: 512_000,
    });
    const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, RecoveryTargetResult>;
    return new Map(Object.entries(parsed));
  } catch (error) {
    console.error("[trade-ledger] Python recovery-target calculation unavailable", error);
    return new Map();
  }
}
