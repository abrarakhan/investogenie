#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/investogenie}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

install -d -m 0700 "${BACKUP_DIR}"
sudo -u postgres pg_dump --format=custom --compress=6 --no-owner --no-acl \
  --file="${BACKUP_DIR}/investogenie-${STAMP}.dump" investogenie
find "${BACKUP_DIR}" -type f -name 'investogenie-*.dump' -mtime +"${KEEP_DAYS}" -delete
