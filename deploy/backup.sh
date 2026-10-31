#!/bin/sh
# Nightly backup (release checklist step 6): a Postgres dump and a copy of every
# stored file, in BACKUP_DIR/<UTC timestamp>/. Keeps KEEP_DAYS days (default 14).
# Copy the backup folder off the VM too (see docs/DEPLOY.md).
set -eu
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ROOT=${BACKUP_DIR:-./backups}
DEST="$ROOT/$STAMP"
mkdir -p "$DEST/files"
DEST_ABS=$(cd "$DEST" && (pwd -W 2>/dev/null || pwd))

# Database: a consistent snapshot while the app runs
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$DEST/db.dump"

# Files: every object of every bucket, copied with the MinIO client (mc). Objects
# are copied as files, so the backup can be restored into any S3-compatible store.
$COMPOSE run --rm --no-deps -T -v "$DEST_ABS/files:/backup" --entrypoint sh minio -c \
  'mc alias set src http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --quiet src /backup'

# Checksums, so a restore can tell a damaged copy
( cd "$DEST" && { sha256sum db.dump; find files -type f | sort | xargs -r sha256sum; } > SHA256SUMS )

find "$ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"${KEEP_DAYS:-14}" -exec rm -rf {} +
echo "Backup written to $DEST ($(du -sh "$DEST" | cut -f1), $(find "$DEST/files" -type f | wc -l | tr -d ' ') files)"
