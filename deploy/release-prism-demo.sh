#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/jellygit/prism}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-prism-demo}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.vps}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.vps.yml}"

cd "$ROOT_DIR"

echo "1/6 Backing up current PRISM demo data..."
bash deploy/backup-prism-demo.sh

echo "2/6 Updating source..."
git checkout main
git pull --ff-only

echo "3/6 Building images..."
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build

echo "4/6 Applying release..."
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo "5/6 Waiting for API readiness..."
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:4001/health/ready >/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "API did not become ready. Inspect logs and restore from the backup created above." >&2
    exit 1
  fi
  sleep 2
done

echo "6/6 Release status:"
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
curl --fail --silent http://127.0.0.1:4001/health/ready
echo
echo "PRISM demo release completed."
