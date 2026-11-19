#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /opt/jellygit/backups/prism/<timestamp>" >&2
  exit 2
fi

ROOT_DIR="${ROOT_DIR:-/opt/jellygit/prism}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-prism-demo}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.vps}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.vps.yml}"
backup_dir="$1"

test -s "$backup_dir/database.dump"
test -s "$backup_dir/uploads.tgz"

cd "$ROOT_DIR"

echo "WARNING: this replaces the current PRISM demo database and synthetic uploads."
echo "Backup source: $backup_dir"
read -r -p "Type RESTORE to continue: " confirm
[[ "$confirm" == "RESTORE" ]] || { echo "Restore cancelled."; exit 1; }

docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api web

docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db   sh -lc 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

cat "$backup_dir/database.dump" | docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db   sh -lc 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists'

docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --no-deps api   sh -lc 'rm -rf /app/backend/uploads/* && tar -C /app/backend/uploads -xzf -'   < "$backup_dir/uploads.tgz"

docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo "Restore complete."
