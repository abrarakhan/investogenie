#!/bin/bash

set -u

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_URL="http://localhost:3000"
VENV_PYTHON="$APP_DIR/.venv/bin/python"

cd "$APP_DIR" || exit 1
printf '\033]0;InvestoGenie\007'

pause_on_error() {
  echo
  read -r -p "Press Return to close this window..." _
  exit 1
}

if curl --silent --fail --max-time 2 "$APP_URL" >/dev/null 2>&1; then
  echo "InvestoGenie is already running. Opening $APP_URL"
  if [ "${INVESTOGENIE_NO_OPEN:-0}" != "1" ]; then
    open "$APP_URL"
  fi
  exit 0
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. Install Node.js, then launch again."
  pause_on_error
fi

if command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready -q -d investogenie; then
    echo "Local PostgreSQL is not ready."
    if command -v brew >/dev/null 2>&1; then
      POSTGRES_SERVICE="$(brew services list 2>/dev/null | awk '/^postgresql(@[0-9]+)?[[:space:]]/ { print $1; exit }')"
      if [ -n "$POSTGRES_SERVICE" ]; then
        echo "Starting $POSTGRES_SERVICE..."
        brew services start "$POSTGRES_SERVICE" >/dev/null
        for _ in {1..20}; do
          pg_isready -q -d investogenie && break
          sleep 1
        done
      fi
    fi
  fi
  if ! pg_isready -q -d investogenie; then
    echo "Could not connect to the local InvestoGenie database. Start PostgreSQL and try again."
    pause_on_error
  fi
fi

if [ ! -x "$VENV_PYTHON" ]; then
  echo "Preparing the NSE updater environment..."
  python3 -m venv "$APP_DIR/.venv" || pause_on_error
fi

if ! "$VENV_PYTHON" -c "import pandas, psycopg2, requests, yfinance" >/dev/null 2>&1; then
  echo "Installing NSE updater dependencies..."
  "$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/pipelines/requirements.txt" || pause_on_error
fi

if [ ! -d "$APP_DIR/node_modules/next" ]; then
  echo "Installing application dependencies..."
  npm install || pause_on_error
fi

if [ "${INVESTOGENIE_NO_OPEN:-0}" != "1" ]; then
  (
    for _ in {1..60}; do
      if curl --silent --fail --max-time 2 "$APP_URL" >/dev/null 2>&1; then
        open "$APP_URL"
        exit 0
      fi
      sleep 1
    done
  ) &
fi

echo
echo "Starting InvestoGenie..."
echo "Keep this window open while using the app."
echo
exec npm run dev
