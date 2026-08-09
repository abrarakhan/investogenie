#!/bin/bash

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

pause() {
  echo
  read -r -p "Press Return to close this window..." _
}

if [ ! -x /opt/homebrew/bin/brew ] && [ ! -x /usr/local/bin/brew ]; then
  echo "Homebrew is required to install Tailscale."
  pause
  exit 1
fi

echo "Installing Tailscale for private InvestoGenie access..."
echo "macOS will ask for your administrator password."
echo

if ! brew install --cask tailscale; then
  echo
  echo "Installation did not complete. If macOS blocked the network extension,"
  echo "allow Tailscale in System Settings > Privacy & Security, then run this again."
  pause
  exit 1
fi

open -a Tailscale

echo
echo "Tailscale is installed. Sign in from the menu-bar app, then install"
echo "Tailscale on your other personal device using the same account."
pause
