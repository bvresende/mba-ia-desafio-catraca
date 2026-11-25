#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[down] Stopping and removing Catraca containers..."
docker compose down --remove-orphans

REMAINING="$(docker compose ps -q)"
if [ -n "$REMAINING" ]; then
  echo "[down] ERROR: Remaining project containers detected: $REMAINING" >&2
  exit 1
fi

echo "[down] All Catraca containers and networks removed."
