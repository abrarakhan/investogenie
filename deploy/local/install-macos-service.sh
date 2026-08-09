#!/bin/bash

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.investogenie.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$APP_DIR/logs"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$APP_DIR"

if [ ! -f .env.local ]; then
  echo "Missing $APP_DIR/.env.local. Configure it before installing the service." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
chmod +x deploy/local/run-macos-service.sh

if [ ! -d node_modules/next ]; then
  npm install
fi

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi

if ! .venv/bin/python -c "import openpyxl, pandas, psycopg2, requests, xlrd, yfinance" >/dev/null 2>&1; then
  .venv/bin/pip install -r pipelines/requirements.txt
fi

echo "Building InvestoGenie for background operation..."
npm run build

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP_DIR/deploy/local/run-macos-service.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/macos-service.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/macos-service.error.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "InvestoGenie is installed as a macOS login service."
echo "Local URL: http://localhost:3000"
echo "Logs: $LOG_DIR/macos-service.log"
