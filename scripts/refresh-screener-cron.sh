#!/bin/bash
# Scheduled screener-snapshot refresh for local runs (launchd / cron).
#
# Reads DATABASE_URL out of .env.local at run time so the credential lives in
# exactly one place (gitignored) instead of being duplicated into a plist or
# crontab entry. Runs the snapshot rebuild directly against Postgres, so it does
# NOT require the Next server to be up.
#
# Install (macOS launchd, every 15 min):
#   launchctl load -w ~/Library/LaunchAgents/com.investogenie.screener-refresh.plist
# Remove:
#   launchctl unload -w ~/Library/LaunchAgents/com.investogenie.screener-refresh.plist
#
# On a deployed (Vercel) environment the equivalent is the /api/cron/refresh-screener
# entry in vercel.json — this script is the local counterpart.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [ ! -f .env.local ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: .env.local not found in $PROJECT_DIR" >&2
  exit 1
fi

# Pull just DATABASE_URL; tolerate surrounding quotes and '=' inside the value.
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
export DATABASE_URL

if [ -z "$DATABASE_URL" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: DATABASE_URL not set in .env.local" >&2
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] refreshing screener snapshot…"
node scripts/refresh-screener.mjs
