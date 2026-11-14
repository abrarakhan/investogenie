#!/usr/bin/env bash
# Dump the production database, then prove the dump is readable before trusting it.
#
# This has to run as root: it writes outside the app's tree and drops to the `postgres`
# role for the dump itself.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/investogenie}"
KEEP_DAYS="${KEEP_DAYS:-7}"
# A dump of this database is well over 100 MB. Anything far below that is a truncated or
# failed write that pg_dump still exited 0 on, so it is refused rather than retained.
MIN_BYTES="${MIN_BYTES:-52428800}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/investogenie-${STAMP}.dump"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi

# `postgres` writes the dump, so the directory has to belong to it. Creating the directory
# root-owned and then dumping as `postgres` fails with "Permission denied" on every run,
# which is how this host reached a release with no backup ever having been written.
# `install -d` also corrects the owner and mode of a directory that already exists.
install -d -m 0700 -o postgres -g postgres "${BACKUP_DIR}"

runuser -u postgres -- pg_dump --format=custom --compress=6 --no-owner --no-acl \
  --file="${TARGET}" investogenie

size="$(stat -c %s "${TARGET}")"
if (( size < MIN_BYTES )); then
  echo "Backup ${TARGET} is only ${size} bytes; refusing to keep it." >&2
  rm -f "${TARGET}"
  exit 1
fi

# A dump that cannot be listed cannot be restored. Checking now, while the previous backups
# are still inside the retention window, is the difference between a backup and a file.
if ! runuser -u postgres -- pg_restore --list "${TARGET}" >/dev/null; then
  echo "Backup ${TARGET} is not readable by pg_restore; refusing to keep it." >&2
  rm -f "${TARGET}"
  exit 1
fi

# Only prune once this run has produced a verified dump, so a failing backup cannot age out
# the last good one.
find "${BACKUP_DIR}" -type f -name 'investogenie-*.dump' -mtime +"${KEEP_DAYS}" -delete

echo "Backup written and verified: ${TARGET} ($(numfmt --to=iec "${size}"))"
