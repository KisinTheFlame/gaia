#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[deploy] Step 1/4: Building images..."
docker compose build

echo "[deploy] Step 2/4: Starting PostgreSQL..."
docker compose up --detach postgres

ready=0
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U gaia -d gaia >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "[deploy] PostgreSQL did not become ready in time."
  exit 1
fi

echo "[deploy] Step 3/4: Applying Prisma migrations..."
docker compose run --rm --no-deps gaia-config-center node_modules/prisma/build/index.js migrate deploy

echo "[deploy] Step 4/4: Starting services..."
docker compose up --detach gaia-config-center gaia-web

echo "[deploy] Done."
