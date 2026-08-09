#!/bin/bash

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_ENV=production
export INVESTOGENIE_NO_OPEN=1

cd "$APP_DIR"

if [ ! -f .env.local ]; then
  echo "Missing $APP_DIR/.env.local" >&2
  exit 1
fi

if ! command -v pg_isready >/dev/null 2>&1; then
  echo "pg_isready is unavailable; install PostgreSQL with Homebrew." >&2
  exit 1
fi

if ! pg_isready -q -d investogenie; then
  POSTGRES_SERVICE="$(brew services list 2>/dev/null | awk '/^postgresql(@[0-9]+)?[[:space:]]/ { print $1; exit }')"
  if [ -n "$POSTGRES_SERVICE" ]; then
    brew services start "$POSTGRES_SERVICE"
  fi

  for _ in {1..30}; do
    pg_isready -q -d investogenie && break
    sleep 1
  done
fi

if ! pg_isready -q -d investogenie; then
  echo "PostgreSQL did not become ready." >&2
  exit 1
fi

if [ ! -d node_modules/next ] || [ ! -f .next/BUILD_ID ]; then
  echo "InvestoGenie is not built. Run deploy/local/install-macos-service.sh." >&2
  exit 1
fi

# Prevent idle sleep while connected to AC power. Scheduled work pauses normally
# if the laptop is closed or running on battery and macOS chooses to sleep.
exec /usr/bin/caffeinate -s npm start -- --hostname 127.0.0.1
