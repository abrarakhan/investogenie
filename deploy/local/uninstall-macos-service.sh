#!/bin/bash

set -euo pipefail

LABEL="com.investogenie.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"

echo "InvestoGenie macOS login service removed. PostgreSQL and application data were not changed."
