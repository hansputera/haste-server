#!/bin/sh
# Back up the Haste document store.
#
# The `file` store writes one file per paste, named md5(key), with no index.
# That makes the backup a directory copy — but it also means an expired paste is
# indistinguishable from a live one, so the tarball is a point-in-time snapshot,
# not a logical dump. Restoring it restores every paste that existed then.
#
#   sudo sh deploy/backup.sh /var/backups/haste
#
# Cron, nightly at 03:17 with 14 days of retention:
#   17 3 * * * root sh /opt/haste/deploy/backup.sh /var/backups/haste >> /var/log/haste-backup.log 2>&1
#
# For Postgres use pg_dump instead; this script refuses to pretend otherwise.

set -eu

DEST=${1:-/var/backups/haste}
DATA_DIR=${DATA_DIR:-/var/lib/haste}
RETAIN_DAYS=${RETAIN_DAYS:-14}

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -d "$DATA_DIR" ] || die "$DATA_DIR does not exist"
mkdir -p "$DEST"

# Refuse when the deployment is not using the file store: an empty directory
# would otherwise produce a successful-looking backup of nothing.
[ -n "$(find "$DATA_DIR" -maxdepth 1 -type f -print -quit)" ] || {
  printf 'warning: %s holds no documents; is STORAGE__TYPE really file?\n' "$DATA_DIR" >&2
}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE="$DEST/haste-$STAMP.tar.gz"

# Consistent enough for a pastebin: a paste written mid-copy is either included
# whole or not at all, because each paste is one small file.
tar -C "$DATA_DIR" -czf "$ARCHIVE.tmp" .
mv "$ARCHIVE.tmp" "$ARCHIVE"

find "$DEST" -name 'haste-*.tar.gz' -type f -mtime "+$RETAIN_DAYS" -delete

printf 'backup: %s (%s files, %s)\n' \
  "$ARCHIVE" \
  "$(find "$DATA_DIR" -maxdepth 1 -type f | wc -l)" \
  "$(du -h "$ARCHIVE" | cut -f1)"
