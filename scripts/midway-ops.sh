#!/usr/bin/env bash
# Run on the InvestoGenie host with DATABASE_URL and CRON_SECRET already loaded.
# Example:
#   set -a; source /etc/investogenie/investogenie.env; set +a
#   cd /opt/investogenie/app && bash scripts/midway-ops.sh status
set -euo pipefail

cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL is required}"
PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
BASE_URL="${INVESTOGENIE_BASE_URL:-http://127.0.0.1:3000}"
ACTION="${1:-status}"

cron_get() {
  : "${CRON_SECRET:?CRON_SECRET is required for this action}"
  curl --fail --silent --show-error -H "Authorization: Bearer ${CRON_SECRET}" "$1"
  echo
}

case "$ACTION" in
  status)
    "$PYTHON_BIN" pipelines/midway_status.py
    ;;
  delivery)
    cron_get "${BASE_URL}/api/cron/backfill-nse"
    ;;
  scan)
    time "$PYTHON_BIN" pipelines/trend_continuation.py
    ;;
  enroll)
    cron_get "${BASE_URL}/api/cron/forward-test?action=enroll&market=IN"
    ;;
  evaluate)
    node scripts/forward-test.mjs evaluate
    ;;
  scorecard)
    node scripts/forward-test.mjs scorecard
    ;;
  replay)
    START="${2:?usage: midway-ops.sh replay YYYY-MM-DD YYYY-MM-DD [output.json]}"
    END="${3:?usage: midway-ops.sh replay YYYY-MM-DD YYYY-MM-DD [output.json]}"
    if [[ -n "${4:-}" ]]; then
      "$PYTHON_BIN" pipelines/midway_replay.py --start "$START" --end "$END" --json > "$4"
      echo "Wrote $4"
    else
      "$PYTHON_BIN" pipelines/midway_replay.py --start "$START" --end "$END"
    fi
    ;;
  today)
    cron_get "${BASE_URL}/api/cron/backfill-nse"
    time "$PYTHON_BIN" pipelines/trend_continuation.py
    cron_get "${BASE_URL}/api/cron/forward-test?action=enroll&market=IN"
    "$PYTHON_BIN" pipelines/midway_status.py
    ;;
  *)
    echo "usage: $0 {status|delivery|scan|enroll|evaluate|scorecard|replay START END [FILE]|today}" >&2
    exit 2
    ;;
esac
