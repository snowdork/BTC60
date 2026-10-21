#!/usr/bin/env bash
# Rebuild the VPS stack or local container without deleting persistent volumes.
set -euo pipefail

if [[ $# -gt 1 || (${1:-} != '' && ${1:-} != '--local') ]]; then
  echo 'Usage: sudo bash scripts/restart-docker.sh [--local]' >&2
  exit 1
fi

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

if ! command -v docker >/dev/null 2>&1; then
  echo 'Install Docker Engine and the Docker Compose plugin first.' >&2
  exit 1
fi
if [[ ${1:-} == --local ]]; then
  if [[ ! -f .env.local ]]; then
    echo 'First run: cp deploy/local.env.example .env.local && chmod 600 .env.local' >&2
    echo 'Edit .env.local to set your local signup code, then rerun with --local.' >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo 'Cannot access Docker. Start the daemon and check Docker permissions.' >&2
    exit 1
  fi
  # Build first so a failed build leaves the existing local app available.
  docker build -t p60:local .
  if docker container inspect p60-local >/dev/null 2>&1; then
    docker stop p60-local
    docker rm p60-local
  fi
  docker run -d \
    --name p60-local \
    --restart unless-stopped \
    --stop-timeout 30 \
    --read-only \
    --tmpfs /tmp:size=64m \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --log-driver local \
    --log-opt max-size=10m \
    --log-opt max-file=5 \
    -p 127.0.0.1:8080:8000 \
    --env-file .env.local \
    -e P60_HOST=http://localhost:8080 \
    -e PREDICT60_DB=/app/data/p60.sqlite3 \
    -v p60-local-data:/app/data \
    p60:local
  for attempt in {1..30}; do
    if docker exec p60-local python3 -c \
      "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).read()" >/dev/null 2>&1; then
      echo 'Local app ready: http://localhost:8080'
      exit 0
    fi
    sleep 2
  done
  echo 'Local app did not become ready. Inspect: sudo docker logs --tail=100 p60-local' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo 'VPS mode requires the Docker Compose plugin. For local development, rerun with --local.' >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo 'Create .env from deploy/docker.env.example and configure your VPS domain and signup code first.' >&2
  exit 1
fi
compose=(docker compose --project-directory "$root" --env-file "$root/.env" -f "$root/compose.yaml")

# Check configuration and permissions before rebuilding.
"${compose[@]}" config --quiet
if ! docker info >/dev/null 2>&1; then
  echo 'Cannot access Docker. Start the daemon and run this script with sudo or Docker group access.' >&2
  exit 1
fi

echo 'Rebuilding the application image...'
if ! "${compose[@]}" build app; then
  echo 'Build failed; existing containers were left running. Fix the build error and rerun this script.' >&2
  exit 1
fi

echo 'Starting the app and HTTPS proxy...'
if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 120; then
  "${compose[@]}" ps -a >&2
  echo 'Startup failed. Inspect: sudo docker compose logs --tail=100 app caddy' >&2
  exit 1
fi
"${compose[@]}" ps
echo 'Restart complete. Check https://YOUR_DOMAIN/healthz to verify public HTTPS.'
