#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

STARTED_DB=0

cleanup() {
  if [ "$STARTED_DB" -eq 1 ]; then
    echo "[gates] Tearing down temporary database container..."
    docker compose down --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "db"; then
  echo "[gates] Starting PostgreSQL container for isolated test run..."
  docker compose up -d db
  STARTED_DB=1
fi

echo "[gates] Waiting for PostgreSQL..."
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U catraca -d catraca >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[gates] ERROR: PostgreSQL did not become ready in time." >&2
    exit 1
  fi
  sleep 1
done

echo "[gates] Ensuring isolated test database catraca_test exists..."
if ! docker compose exec -T db psql -U catraca -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'catraca_test'" | grep -qx "1"; then
  docker compose exec -T db psql -U catraca -d postgres -c "CREATE DATABASE catraca_test;"
fi

echo "[gates] Building app image with current workspace code..."
docker compose build app

echo "[gates] Running migrations, typecheck (tsc --noEmit), and Vitest against catraca_test..."
docker compose run --rm --no-deps \
  -e DATABASE_URL="postgres://catraca:catraca@db:5432/catraca_test" \
  -e NODE_ENV="test" \
  app sh -c "npm run db:migrate && npm run gates:internal"

echo "[gates] All gates passed."
