#!/bin/bash

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$APP_DIR"
printf '\033]0;Reset InvestoGenie Password\007'

finish() {
  unset INVESTOGENIE_RESET_EMAIL INVESTOGENIE_RESET_PASSWORD
  echo
  read -r -p "Press Return to close this window..." _
}
trap finish EXIT

echo "Reset an existing InvestoGenie account password"
echo "Portfolio holdings and account data will be preserved."
echo

read -r -p "Account email: " INVESTOGENIE_RESET_EMAIL
read -r -s -p "New password (at least 6 characters): " INVESTOGENIE_RESET_PASSWORD
echo
read -r -s -p "Confirm new password: " password_confirmation
echo

if [ "$INVESTOGENIE_RESET_PASSWORD" != "$password_confirmation" ]; then
  echo "Passwords do not match." >&2
  exit 1
fi

export INVESTOGENIE_RESET_EMAIL INVESTOGENIE_RESET_PASSWORD
node scripts/reset-local-password.mjs

echo
echo "You can now sign in from your phone using the new password."
