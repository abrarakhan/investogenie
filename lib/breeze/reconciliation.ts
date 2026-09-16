import { spawn } from "node:child_process";
import { queryOne } from "@/lib/db";

/**
 * Start the read-only account reconciliation after a daily token is replaced.
 * The recurring scheduler still owns market-hours polling; this closes the gap
 * between an early-morning token save and the first scheduled market-hours run.
 */
export async function triggerBreezeReconciliation(): Promise<boolean> {
  if (process.env.BREEZE_ACCOUNT_SYNC_DISABLED === "1") return false;

  const running = await queryOne<{ running: boolean }>(
    `select exists(
       select 1 from public.breeze_broker_syncs
        where status='RUNNING' and started_at >= now() - interval '15 minutes'
     ) running`,
  );
  if (running?.running) return false;

  const root = process.cwd();
  // Build runtime paths dynamically so Turbopack does not treat the Python
  // executable or worker as JavaScript module dependencies.
  const python = process.env.PYTHON_BIN?.trim() || [root, ".venv", "bin", "python"].join("/");
  const worker = [root, "workers", "breeze_account_sync.py"].join("/");

  const child = spawn(python, [worker], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    console.error(`[breeze-account] immediate reconciliation failed to start: ${error.message}`);
  });
  child.unref();
  return true;
}
