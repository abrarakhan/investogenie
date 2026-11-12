import { Client } from "pg";

// Forward testing runs inside the production service: after each market's EOD
// job, grade open positions against the new bars, and freeze a new cohort for
// that market about once a week. Enrolment itself stays behind the app route
// because it needs the TypeScript screening engines.
export const ENROLL_INTERVAL_DAYS = 6;

export function enrollmentDue(lastEnrolledAt, now = new Date()) {
  if (!lastEnrolledAt) return true;
  return now.getTime() - new Date(lastEnrolledAt).getTime() >= ENROLL_INTERVAL_DAYS * 86_400_000;
}

export async function lastEnrollment(databaseUrl, market) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select max(created_at) as at from public.cron_logs
        where job = 'forward-test' and status = 'ok'
          and detail->>'action' = 'enroll' and detail->>'market' = $1`,
      [market],
    );
    return rows[0]?.at ?? null;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runForwardTestStage({ market, callRoute, lastEnrolledAt, now = new Date() }) {
  const evaluated = await callRoute("action=evaluate");
  const enrolled = enrollmentDue(lastEnrolledAt, now)
    ? await callRoute(`action=enroll&market=${market}`)
    : null;
  return { evaluated, enrolled };
}
