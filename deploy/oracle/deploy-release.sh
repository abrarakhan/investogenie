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
  "set -a; source /etc/investogenie/investogenie.env; set +a; cd '${APP_DIR}' && node scripts/apply-production-migrations.mjs"

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
