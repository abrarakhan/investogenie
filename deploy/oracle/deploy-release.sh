#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi

APP_USER="${APP_USER:-investogenie}"
APP_DIR="${APP_DIR:-/opt/investogenie/app}"

# Older releases allowed npm prune to rewrite the tracked lockfile on the host.
# Restore that generated deployment-only change before pulling, but refuse to
# overwrite any other local production edits.
sudo -u "${APP_USER}" git -C "${APP_DIR}" restore --worktree -- package-lock.json
if [[ -n "$(sudo -u "${APP_USER}" git -C "${APP_DIR}" status --porcelain)" ]]; then
  echo "Production checkout has uncommitted changes; refusing to deploy." >&2
  sudo -u "${APP_USER}" git -C "${APP_DIR}" status --short >&2
  exit 1
fi

sudo -u "${APP_USER}" git -C "${APP_DIR}" fetch origin main
sudo -u "${APP_USER}" git -C "${APP_DIR}" checkout main
sudo -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only origin main

# This script can update itself in the pull above. Re-exec the checked-out
# version once so newly added migrations and verification steps are used by
# the same deployment instead of being deferred until the next release.
if [[ "${INVESTOGENIE_DEPLOY_REEXEC:-0}" != "1" ]]; then
  exec env INVESTOGENIE_DEPLOY_REEXEC=1 bash "${APP_DIR}/deploy/oracle/deploy-release.sh"
fi

sudo -u "${APP_USER}" bash -lc \
  "set -a; source /etc/investogenie/investogenie.env; set +a; cd '${APP_DIR}' && npm ci --include=dev && npm audit --omit=dev --audit-level=high && npm run build"
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/pipelines/requirements.txt"
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/workers/requirements.txt"

sudo -u "${APP_USER}" bash -lc \
  "set -a; source /etc/investogenie/investogenie.env; set +a; cd '${APP_DIR}' && node scripts/apply-migration.mjs db/migrations/0033_breeze_credentials.sql && node scripts/apply-migration.mjs db/migrations/0034_swing_trade_partial_exits.sql && node scripts/apply-migration.mjs db/migrations/0035_gmail_auto_import.sql && node scripts/apply-migration.mjs db/migrations/0036_gmail_disclosure_links.sql && node scripts/apply-migration.mjs db/migrations/0037_resolved_cas_rejections.sql && node scripts/apply-migration.mjs db/migrations/0038_ohlcv_source.sql && node scripts/apply-migration.mjs db/migrations/0039_live_market_targets.sql && node scripts/apply-migration.mjs db/migrations/0040_breeze_broker_snapshots.sql && node scripts/apply-migration.mjs db/migrations/0041_breeze_execution_safety.sql && node scripts/apply-migration.mjs db/migrations/0042_news_evidence_quality.sql && node scripts/apply-migration.mjs db/migrations/0043_multi_news_providers.sql && node scripts/apply-migration.mjs db/migrations/0044_mobile_sessions.sql && node scripts/apply-migration.mjs db/migrations/0045_mobile_push.sql && node scripts/apply-migration.mjs db/migrations/0046_trade_ledger_returns.sql && node scripts/apply-migration.mjs db/migrations/0047_trade_ledger_gtt.sql && node scripts/apply-migration.mjs db/migrations/0048_adaptive_allocation.sql && node scripts/apply-migration.mjs db/migrations/0049_breeze_auto_buy.sql && node scripts/apply-migration.mjs db/migrations/0050_mobile_candidate_alerts.sql && node scripts/apply-migration.mjs db/migrations/0051_ml_advisory_foundation.sql && node scripts/apply-migration.mjs db/migrations/0052_corporate_results_calendar.sql && node scripts/apply-migration.mjs db/migrations/0053_armed_swing_plans.sql && node scripts/apply-migration.mjs db/migrations/0054_swing_pending_orders.sql && node scripts/apply-migration.mjs db/migrations/0055_swing_execution_plans.sql && node scripts/apply-migration.mjs db/migrations/0056_corporate_calendar_coverage.sql && node scripts/apply-migration.mjs db/migrations/0057_gmail_connection_health.sql && node scripts/apply-migration.mjs db/migrations/0058_screener_technical_features.sql && node scripts/apply-migration.mjs db/migrations/0059_candidate_signal_observations.sql && node scripts/apply-migration.mjs db/migrations/0060_trend_continuation.sql && node scripts/apply-migration.mjs db/migrations/0061_browser_notifications.sql"

sudo -u "${APP_USER}" bash -lc \
  "set -a; source /etc/investogenie/investogenie.env; set +a; cd '${APP_DIR}' && .venv/bin/python pipelines/screener_technical_features.py --market IN --bootstrap && node scripts/refresh-screener.mjs IN"

sudo -u "${APP_USER}" bash -lc \
  "set -a; source /etc/investogenie/investogenie.env; set +a; cd '${APP_DIR}' && node scripts/verify-production-schema.mjs"

install -m 0644 "${APP_DIR}/deploy/oracle/investogenie.service" \
  /etc/systemd/system/investogenie.service
install -m 0644 "${APP_DIR}/deploy/oracle/investogenie-breeze.service" \
  /etc/systemd/system/investogenie-breeze.service
systemctl daemon-reload

systemctl restart investogenie
systemctl enable --now investogenie-breeze.service
systemctl restart investogenie-breeze.service
sleep 5
curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null
systemctl --no-pager --full status investogenie
