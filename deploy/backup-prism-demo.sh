#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/jellygit/prism}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/jellygit/backups/prism}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-prism-demo}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.vps}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.vps.yml}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_ROOT/$timestamp"

mkdir -p "$target"

cd "$ROOT_DIR"

echo "Creating PRISM backup in $target"

docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db   sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges'   > "$target/database.dump"

docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api   sh -lc 'tar -C /app/backend/uploads -czf - .'   > "$target/uploads.tgz"

git rev-parse HEAD > "$target/git-sha.txt"
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps > "$target/compose-ps.txt"

cat > "$target/README.txt" <<EOF
PRISM synthetic demo/UAT backup
Created UTC: $timestamp
Database: database.dump
Synthetic uploads: uploads.tgz
Source commit: $(cat "$target/git-sha.txt")
EOF

test -s "$target/database.dump"
test -s "$target/uploads.tgz"

echo "Backup complete: $target"
