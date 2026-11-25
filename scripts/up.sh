#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[up] Building and starting Catraca services..."
docker compose up --build -d

echo "[up] Waiting for PostgreSQL to accept connections..."
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U catraca -d catraca >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[up] ERROR: PostgreSQL did not become ready in time." >&2
    exit 1
  fi
  sleep 1
done

echo "[up] Applying database migrations..."
docker compose exec -T app npm run db:migrate

echo "[up] Running idempotent database seed..."
docker compose exec -T app npm run db:seed

echo "[up] Waiting for http://localhost:3000/health..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    echo "[up] Catraca is up and healthy at http://localhost:3000"
    exit 0
  fi
  sleep 1
done

echo "[up] ERROR: Application did not become healthy at http://localhost:3000/health." >&2
docker compose logs app --tail=50 >&2 || true
exit 1
