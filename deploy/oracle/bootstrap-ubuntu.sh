#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo DB_PASSWORD=<hex-password> DOMAIN=<domain> bash $0" >&2
  exit 1
fi

APP_USER="${APP_USER:-investogenie}"
APP_ROOT="${APP_ROOT:-/opt/investogenie}"
APP_DIR="${APP_DIR:-${APP_ROOT}/app}"
REPO_URL="${REPO_URL:-https://github.com/abrarakhan/investogenie.git}"
DOMAIN="${DOMAIN:-_}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"

if [[ ! ${DB_PASSWORD} =~ ^[A-Za-z0-9]+$ ]]; then
  echo "DB_PASSWORD must be alphanumeric so it is safe in DATABASE_URL." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  ca-certificates curl gnupg git build-essential openssl \
  python3 python3-dev python3-venv libpq-dev \
  postgresql postgresql-contrib nginx certbot python3-certbot-nginx \
  ufw

if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${APP_ROOT}" --shell /bin/bash "${APP_USER}"
fi
install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_ROOT}" /var/log/investogenie
install -d -m 0750 -o root -g "${APP_USER}" /etc/investogenie

if [[ ! -d "${APP_DIR}/.git" ]]; then
  sudo -u "${APP_USER}" git clone "${REPO_URL}" "${APP_DIR}"
fi

sudo -u "${APP_USER}" python3 -m venv "${APP_DIR}/.venv"
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install --upgrade pip wheel
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/pipelines/requirements.txt"

pushd "${APP_DIR}" >/dev/null
sudo -u "${APP_USER}" npm ci
popd >/dev/null

if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='investogenie'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "create role investogenie login password '${DB_PASSWORD}'"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "alter role investogenie password '${DB_PASSWORD}'"
fi
if ! sudo -u postgres psql -tAc "select 1 from pg_database where datname='investogenie'" | grep -q 1; then
  sudo -u postgres createdb --owner=investogenie investogenie
fi

ENV_FILE=/etc/investogenie/investogenie.env
if [[ ! -f "${ENV_FILE}" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  CRON_SECRET="$(openssl rand -hex 32)"
  CREDENTIAL_KEY="$(openssl rand -hex 32)"
  cat >"${ENV_FILE}" <<EOF
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3000
NEXT_PUBLIC_APP_URL=http://${DOMAIN}
DATABASE_URL=postgresql://investogenie:${DB_PASSWORD}@127.0.0.1:5432/investogenie
SESSION_SECRET=${SESSION_SECRET}
CRON_SECRET=${CRON_SECRET}
CREDENTIAL_ENCRYPTION_KEY=${CREDENTIAL_KEY}
PYTHON_BIN=${APP_DIR}/.venv/bin/python
FUNDAMENTALS_SYNC_LIMIT=100
US_FUNDAMENTALS_LIMIT=100
US_HISTORY_LIMIT=75
US_QUOTE_LIMIT=1000
MARKET_REFRESH_INTERVAL_MINUTES=60
INDIA_MARKET_QUOTE_REFRESH_INTERVAL_MINUTES=15
EOF
  chown root:"${APP_USER}" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
fi

sed "s/__DOMAIN__/${DOMAIN}/g" "${APP_DIR}/deploy/oracle/nginx.conf.template" \
  >/etc/nginx/sites-available/investogenie
ln -sfn /etc/nginx/sites-available/investogenie /etc/nginx/sites-enabled/investogenie
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now postgresql nginx

install -m 0644 "${APP_DIR}/deploy/oracle/investogenie.service" \
  /etc/systemd/system/investogenie.service
systemctl daemon-reload

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

cat <<EOF

Bootstrap complete.

Database credentials and application secrets were written to:
  ${ENV_FILE}

Before starting the app:
  1. Restore the local PostgreSQL dump.
  2. Copy the existing CREDENTIAL_ENCRYPTION_KEY into ${ENV_FILE} if encrypted credentials exist.
  3. Build and start:
       sudo -u ${APP_USER} bash -lc 'set -a; source ${ENV_FILE}; set +a; cd ${APP_DIR} && npm run build'
       systemctl enable --now investogenie
  4. After DNS resolves, enable HTTPS:
       certbot --nginx -d ${DOMAIN}
EOF
