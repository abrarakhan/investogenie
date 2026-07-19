#!/bin/bash
# Local forward-test driver (launchd). Runs daily.
#
#   evaluate -> always, via the CLI, which talks to Postgres directly and so
#               does not need the Next server to be running.
#   enroll   -> Mondays only, and only if the server is up: enrolment needs the
#               TypeScript engines (runScreener / getProbabilitySummary), which
#               only exist behind the app.
set -uo pipefail
cd /Users/abrarahmedkhan/Projects/investogenie

if [ ! -f .env.local ]; then
  echo "[$(date '+%F %T')] ERROR: .env.local not found" >&2; exit 1
fi
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
CRON_SECRET="$(grep -m1 '^CRON_SECRET=' .env.local | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
export DATABASE_URL

echo "[$(date '+%F %T')] evaluating open positions"
node scripts/forward-test.mjs evaluate

# 1 = Monday
if [ "$(date +%u)" = "1" ]; then
  if curl -sf -o /dev/null --max-time 5 http://localhost:3000/; then
    for MKT in IN US; do
      echo "[$(date '+%F %T')] enrolling $MKT cohort"
      curl -s -H "Authorization: Bearer ${CRON_SECRET}" \
        "http://localhost:3000/api/cron/forward-test?action=enroll&market=${MKT}" | head -c 400
      echo
    done
  else
    echo "[$(date '+%F %T')] server down — skipping enrolment (evaluation still ran)" >&2
  fi
fi
