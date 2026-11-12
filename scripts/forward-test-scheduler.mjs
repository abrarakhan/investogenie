// Forward testing runs inside the production service. After each market's EOD
// job: grade open positions against the new bars, then enrol that session's
// calls for that market. Enrolment stays behind the app route because it needs
// the TypeScript engines; it skips stocks that already have a live call for the
// same method, so running it every session does not double-count a trade.
export async function runForwardTestStage({ market, callRoute }) {
  const evaluated = await callRoute("action=evaluate");
  const enrolled = await callRoute(`action=enroll&market=${market}`);
  return { evaluated, enrolled };
}
