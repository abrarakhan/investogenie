import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const worker = resolve(root, "pipelines/strategy_math_worker.py");
const MAX_WORKERS = Math.max(1, Math.min(4, Number(process.env.PYTHON_STRATEGY_WORKERS ?? 2)));
const REQUEST_TIMEOUT_MS = Math.max(10_000, Number(process.env.PYTHON_STRATEGY_TIMEOUT_MS ?? 60_000));
const IDLE_SHUTDOWN_MS = process.env.VITEST ? 3_000 : 120_000;

function pythonBin(): string {
  // The service wrapper sets PYTHON_BIN to the release venv. Do not inspect the
  // local .venv here: Turbopack follows that symlink during builds, and on macOS
  // its Homebrew target is outside the project filesystem root.
  return process.env.PYTHON_BIN?.trim() || "python3";
}

interface PendingJob {
  id: number;
  engine: string;
  payloadLine: string;
  expectedLength: number;
  resolve: (results: unknown[]) => void;
  reject: (error: Error) => void;
}

interface ActiveJob extends PendingJob {
  timer: ReturnType<typeof setTimeout>;
}

interface PersistentWorker {
  child: ChildProcessWithoutNullStreams;
  busy: boolean;
  closed: boolean;
  buffer: string;
  stderr: string[];
  current: ActiveJob | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface PoolState {
  workers: PersistentWorker[];
  queue: PendingJob[];
  nextId: number;
  exitHooked: boolean;
}

const pool: PoolState = ((globalThis as { __investogeniePythonStrategyPool?: PoolState })
  .__investogeniePythonStrategyPool ??= { workers: [], queue: [], nextId: 1, exitHooked: false });

function unrefStream(stream: unknown): void {
  const handle = stream as { unref?: () => void } | null | undefined;
  handle?.unref?.();
}

function refStream(stream: unknown): void {
  const handle = stream as { ref?: () => void } | null | undefined;
  handle?.ref?.();
}

function setWorkerIdle(slot: PersistentWorker): void {
  slot.busy = false;
  slot.child.unref();
  unrefStream(slot.child.stdin);
  unrefStream(slot.child.stdout);
  unrefStream(slot.child.stderr);
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = setTimeout(() => {
    slot.idleTimer = null;
    if (!slot.busy && !slot.closed) destroyWorker(slot);
  }, IDLE_SHUTDOWN_MS);
  slot.idleTimer.unref?.();
}

function setWorkerActive(slot: PersistentWorker): void {
  slot.busy = true;
  if (slot.idleTimer) {
    clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
  }
  slot.child.ref();
  refStream(slot.child.stdin);
  refStream(slot.child.stdout);
  refStream(slot.child.stderr);
}

function removeWorker(slot: PersistentWorker): void {
  const idx = pool.workers.indexOf(slot);
  if (idx >= 0) pool.workers.splice(idx, 1);
}

function destroyWorker(slot: PersistentWorker, failError?: Error): void {
  if (slot.closed) return;
  slot.closed = true;
  if (slot.idleTimer) {
    clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
  }
  removeWorker(slot);
  const current = slot.current;
  slot.current = null;
  if (current) {
    clearTimeout(current.timer);
    current.reject(failError ?? new Error(`Python ${current.engine} worker closed unexpectedly`));
  }
  try {
    slot.child.stdin.end();
  } catch {
    // ignore broken pipe on shutdown
  }
  try {
    slot.child.kill("SIGTERM");
  } catch {
    // ignore already-exited child
  }
  drainQueue();
}

function handleLine(slot: PersistentWorker, line: string): void {
  const current = slot.current;
  if (!current) return;
  slot.current = null;
  clearTimeout(current.timer);
  try {
    const value = JSON.parse(line) as {
      id?: number;
      ok?: boolean;
      engine?: string;
      results?: unknown[];
      error?: string;
    };
    if (value.id !== current.id) {
      destroyWorker(slot, new Error(`Python ${current.engine} worker response id mismatch`));
      return;
    }
    if (!value.ok) {
      current.reject(new Error(`Python ${current.engine} engine failed: ${value.error || "unknown error"}`));
    } else if (value.engine !== current.engine || !Array.isArray(value.results) || value.results.length !== current.expectedLength) {
      current.reject(new Error("Python strategy engine returned an invalid batch"));
    } else {
      current.resolve(value.results);
    }
  } catch (error) {
    current.reject(error instanceof Error ? error : new Error(String(error)));
    destroyWorker(slot);
    return;
  }
  setWorkerIdle(slot);
  drainQueue();
}

function spawnPersistentWorker(): PersistentWorker {
  if (!pool.exitHooked) {
    pool.exitHooked = true;
    process.once("beforeExit", () => shutdownPythonStrategyWorkers());
    process.once("exit", () => shutdownPythonStrategyWorkers());
  }
  const child = spawn(/* turbopackIgnore: true */ pythonBin(), [worker, "--serve"], {
    cwd: root,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const slot: PersistentWorker = {
    child,
    busy: false,
    closed: false,
    buffer: "",
    stderr: [],
    current: null,
    idleTimer: null,
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    slot.buffer += chunk;
    let newlineIndex = slot.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = slot.buffer.slice(0, newlineIndex).trim();
      slot.buffer = slot.buffer.slice(newlineIndex + 1);
      if (line) handleLine(slot, line);
      newlineIndex = slot.buffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk: string) => {
    slot.stderr.push(chunk);
    if (slot.stderr.length > 16) slot.stderr.shift();
  });
  child.once("error", (error) => {
    destroyWorker(slot, error);
  });
  child.once("close", (code, signal) => {
    const details = slot.stderr.join("").trim();
    const err = new Error(
      `Python ${slot.current?.engine ?? "strategy"} engine failed (${signal ?? code})${details ? `: ${details}` : ""}`,
    );
    destroyWorker(slot, err);
  });
  pool.workers.push(slot);
  return slot;
}

function dispatchToWorker(slot: PersistentWorker, job: PendingJob): void {
  setWorkerActive(slot);
  const timer = setTimeout(() => {
    destroyWorker(slot, new Error(`Python ${job.engine} engine failed (SIGTERM): timed out after ${REQUEST_TIMEOUT_MS}ms`));
  }, REQUEST_TIMEOUT_MS);
  timer.unref?.();
  slot.current = { ...job, timer };
  slot.stderr.length = 0;
  try {
    slot.child.stdin.write(job.payloadLine);
  } catch (error) {
    destroyWorker(slot, error instanceof Error ? error : new Error(String(error)));
  }
}

function drainQueue(): void {
  while (pool.queue.length > 0) {
    let slot = pool.workers.find((candidate) => !candidate.busy && !candidate.closed);
    if (!slot && pool.workers.length < MAX_WORKERS) {
      slot = spawnPersistentWorker();
    }
    if (!slot) return;
    const job = pool.queue.shift()!;
    dispatchToWorker(slot, job);
  }
}

/** Cleanly terminate any resident Python strategy workers. */
export function shutdownPythonStrategyWorkers(): void {
  for (const slot of [...pool.workers]) {
    destroyWorker(slot);
  }
}

/**
 * Run one Python-owned strategy engine for a complete batch. TypeScript may
 * gather data and validate the returned shape, but it must not recompute a
 * status, score, gate or trade level.
 *
 * Uses a small resident NDJSON worker pool (`strategy_math_worker.py --serve`)
 * to avoid spawning a fresh Python interpreter and re-importing every strategy
 * module on every page view or cron tick.
 */
export async function runPythonStrategyBatch<TInput, TResult>(
  engine: string,
  inputs: readonly TInput[],
  shared?: Record<string, unknown>,
): Promise<TResult[]> {
  if (inputs.length === 0) return [];
  if (!existsSync(worker)) throw new Error(`Python strategy worker is unavailable: ${worker}`);
  const id = pool.nextId++;
  const payload = shared && Object.keys(shared).length > 0
    ? { id, engine, inputs, shared }
    : { id, engine, inputs };
  const payloadLine = `${JSON.stringify(payload)}\n`;
  return new Promise<TResult[]>((resolveRun, rejectRun) => {
    pool.queue.push({
      id,
      engine,
      payloadLine,
      expectedLength: inputs.length,
      resolve: (results) => resolveRun(results as TResult[]),
      reject: rejectRun,
    });
    drainQueue();
  });
}
