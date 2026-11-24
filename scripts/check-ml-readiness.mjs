import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { workerQuery } from "@/lib/db";

const root = process.cwd();
const market = process.argv[2] === "US" ? "US" : "IN";
const l2 = process.argv[3] ?? "25";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pythonCandidates = [
  process.env.PYTHON_BIN,
  resolve(root, ".venv/bin/python"),
  resolve(root, ".venv/bin/python3"),
  "python3",
].filter(Boolean);
const python = pythonCandidates.find((candidate) => candidate.includes("/") ? existsSync(candidate) : true);
if (!python) throw new Error("Python runtime is unavailable");

const result = spawnSync(
  python,
  [
    resolve(root, "pipelines/ml/train.py"),
    "--database-url", process.env.DATABASE_URL,
    "--market", market,
    "--l2", l2,
  ],
  { cwd: root, env: process.env, encoding: "utf8", timeout: 120_000 },
);

if (result.status !== 0) {
  console.error(`[ml-readiness] train.py failed: ${result.stderr || result.stdout}`);
  process.exit(1);
}

const report = JSON.parse(result.stdout.trim());
const verdict = String(report.verdict ?? "UNKNOWN");

let priorNotifiedAt = null;
try {
  const existing = await workerQuery(
    `select notified_at from public.ml_readiness_checks where market = $1`,
    [market],
  );
  priorNotifiedAt = existing[0]?.notified_at ? new Date(existing[0].notified_at) : null;

  await workerQuery(
    `insert into public.ml_readiness_checks (
       market, verdict, samples, distinct_dates, samples_with_news,
       oos_ml_auc, oos_baseline_auc, oos_brier, report_json, checked_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
     on conflict (market) do update set
       verdict = excluded.verdict,
       samples = excluded.samples,
       distinct_dates = excluded.distinct_dates,
       samples_with_news = excluded.samples_with_news,
       oos_ml_auc = excluded.oos_ml_auc,
       oos_baseline_auc = excluded.oos_baseline_auc,
       oos_brier = excluded.oos_brier,
       report_json = excluded.report_json,
       checked_at = now()`,
    [
      market,
      verdict,
      Number(report.samples ?? 0),
      Number(report.distinct_dates ?? 0),
      Number(report.samples_with_news ?? 0),
      report.oos_ml_auc ?? null,
      report.oos_baseline_auc ?? null,
      report.oos_brier ?? null,
      JSON.stringify(report),
    ],
  );
} catch (error) {
  if (error?.code !== "42P01") {
    console.warn(`[ml-readiness] could not persist readiness row: ${error.message}`);
  }
}

const recentlyNotified = priorNotifiedAt && Date.now() - priorNotifiedAt.getTime() < 14 * 86_400_000;

if (verdict === "READY_FOR_SHADOW" && !recentlyNotified) {
  const title = `InvestoGenie ML Ready (${market})`;
  const body = `Walk-forward model passed all gates (AUC ${report.oos_ml_auc} vs ${report.oos_baseline_auc} baseline across ${report.distinct_dates} dates, ${report.samples} trades). Ready for Stage 4C Shadow Mode.`;
  let sentCount = 0;

  try {
    const tokens = await workerQuery(
      `select distinct t.expo_push_token
         from public.mobile_push_tokens t
         join public.users u on u.id = t.user_id
        where t.enabled = true and u.role = 'ADMIN'`,
    );
    for (const row of tokens) {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          to: row.expo_push_token,
          title,
          body,
          sound: "default",
          data: { screen: "strong-swing", market },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) sentCount += 1;
    }
  } catch (error) {
    console.warn(`[ml-readiness] Expo push failed: ${error.message}`);
  }

  if (sentCount > 0) {
    await workerQuery(
      `update public.ml_readiness_checks set notified_at = now() where market = $1`,
      [market],
    ).catch(() => undefined);
  }
  console.log(`[ml-readiness] market=${market} READY_FOR_SHADOW (pushed=${sentCount})`);
} else {
  console.log(
    `[ml-readiness] market=${market} verdict=${verdict} dates=${report.distinct_dates ?? 0} samples=${report.samples ?? 0} with_news=${report.samples_with_news ?? 0} auc=${report.oos_ml_auc ?? "n/a"}`,
  );
}
