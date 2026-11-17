import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const worker = resolve(root, "pipelines/strategy_math_worker.py");

/**
 * How long one engine batch may take before it is killed.
 *
 * This was 30s, which a batch of a few thousand stocks could not meet whenever it had to
 * share the box's two CPUs. The engine was SIGTERMed, the page it was rendering failed, and
 * the browser aborted waiting -- the nginx 499s on /terminal/in/strong-swing. Killing the
 * work early does not make a slow page fast; it only turns it into a broken one.
 *
 * nginx allows 300s upstream, so 90s is well inside what the proxy will wait for while still
 * bounding a stuck worker. The contention itself is addressed separately, by the recurring
 * trend scan in scripts/run-with-nse-sync.mjs no longer holding a CPU continuously.
 */
const ENGINE_TIMEOUT_MS = Number(process.env.PYTHON_ENGINE_TIMEOUT_MS ?? 90_000);

function pythonBin(): string {
  // The service wrapper sets PYTHON_BIN to the release venv. Do not inspect the
  // local .venv here: Turbopack follows that symlink during builds, and on macOS
  // its Homebrew target is outside the project filesystem root.
  return process.env.PYTHON_BIN?.trim() || "python3";
}

/**
 * Run one Python-owned strategy engine for a complete batch. TypeScript may
 * gather data and validate the returned shape, but it must not recompute a
 * status, score, gate or trade level.
 */
export async function runPythonStrategyBatch<TInput, TResult>(
  engine: string,
  inputs: readonly TInput[],
): Promise<TResult[]> {
  if (!existsSync(worker)) throw new Error(`Python strategy worker is unavailable: ${worker}`);
  return new Promise<TResult[]>((resolveRun, rejectRun) => {
    const child = spawn(/* turbopackIgnore: true */ pythonBin(), [worker], {
      cwd: root,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), ENGINE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal) {
        rejectRun(new Error(`Python ${engine} engine failed (${signal ?? code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(stdout).toString("utf8")) as { engine?: string; results?: TResult[] };
        if (value.engine !== engine || !Array.isArray(value.results) || value.results.length !== inputs.length) {
          throw new Error("Python strategy engine returned an invalid batch");
        }
        resolveRun(value.results);
      } catch (error) {
        rejectRun(error);
      }
    });
    child.stdin.end(JSON.stringify({ engine, inputs }));
  });
}
