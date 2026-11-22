#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" && -r .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set (or available in .env.local)}"

PYTHON_BIN="${PYTHON_BIN:-$ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python environment not found at $PYTHON_BIN" >&2
  exit 1
fi

# No limit means a full one-time catch-up. Pass --limit N or --symbols AAPL,MSFT
# for a bounded run. --force is intentional: this operator command refreshes
# every selected company regardless of prior provider state.
exec "$PYTHON_BIN" pipelines/sec_edgar_fundamentals.py --force "$@"
