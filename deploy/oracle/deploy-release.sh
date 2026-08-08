#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi

APP_USER="${APP_USER:-investogenie}"
APP_DIR="${APP_DIR:-/opt/investogenie/app}"

sudo -u "${APP_USER}" git -C "${APP_DIR}" fetch origin main
sudo -u "${APP_USER}" git -C "${APP_DIR}" checkout main
sudo -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only origin main

sudo -u "${APP_USER}" bash -lc \
  "set -a; source /etc/investogenie/investogenie.env; set +a; cd '${APP_DIR}' && npm ci && npm run build"
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/pipelines/requirements.txt"

systemctl restart investogenie
sleep 5
curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null
systemctl --no-pager --full status investogenie
