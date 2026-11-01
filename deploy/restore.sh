#!/bin/sh
# Restore a backup made by backup.sh:  deploy/restore.sh backups/20261101T030000Z
# REPLACES the current database and stored files. The app is offline while it runs.
# Set CONFIRM=RESTORE to skip the question (for scripted restore tests).
set -eu
cd "$(dirname "$0")/.."
SRC=${1:?usage: deploy/restore.sh <backup folder>}
SRC_ABS=$(cd "$SRC" && (pwd -W 2>/dev/null || pwd))
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
STORAGE=$(sed -n 's/^STORAGE=//p' .env.production | tail -1)
STORAGE=${STORAGE:-bundled}

( cd "$SRC" && sha256sum -c --quiet SHA256SUMS )
if [ "${CONFIRM:-}" != "RESTORE" ]; then
  printf 'This replaces ALL current data with %s. Type RESTORE to continue: ' "$SRC"
  read -r answer
  [ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
fi

$COMPOSE stop api web
if [ "$STORAGE" = "bundled" ]; then $COMPOSE up -d --wait postgres minio; else $COMPOSE up -d --wait postgres; fi

# Database: recreate it empty, then load the dump
$COMPOSE exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
$COMPOSE exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$SRC/db.dump"

# Files: make storage match the backup exactly (objects not in the backup are removed).
# With external storage, restore files with the provider's own tools (docs/DEPLOY.md).
[ "$STORAGE" = "bundled" ] && $COMPOSE run --rm --no-deps -T -v "$SRC_ABS/files:/backup:ro" --entrypoint sh minio -c \
  'mc alias set dst http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && for b in /backup/*/; do [ -d "$b" ] || continue; n=$(basename "$b"); mc mb --ignore-existing "dst/$n" >/dev/null; mc mirror --quiet --overwrite --remove "$b" "dst/$n"; done'

$COMPOSE up -d api web
echo "Restored from $SRC."
