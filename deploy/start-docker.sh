#!/usr/bin/env bash
# Build and start the Docker services, waiting for application readiness.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

if ! command -v docker >/dev/null 2>&1; then
  echo 'Install Docker Engine and the Docker Compose plugin first.' >&2
  exit 1
fi
docker compose version >/dev/null
if [[ ! -f .env ]]; then
  echo 'Create .env from deploy/docker.env.example, chmod 600 .env, and set P60_DOMAIN before starting.' >&2
  exit 1
fi

# Validate without printing the rendered configuration, which contains secrets.
docker compose config --quiet
if ! docker info >/dev/null 2>&1; then
  echo 'Cannot access Docker. Start the daemon and check your Docker socket permissions.' >&2
  exit 1
fi

# Keep Python as the container foreground process; Docker supervises restarts.
# A failed readiness check leaves containers available for log inspection.
if ! docker compose up -d --build --wait --wait-timeout 120; then
  docker compose ps >&2
  echo 'Startup failed. Inspect: docker compose logs --tail=100 app caddy' >&2
  exit 1
fi
docker compose ps
echo 'Docker services are running. Check public HTTPS /healthz before opening the site to users.'
