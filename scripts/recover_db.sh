#!/usr/bin/env bash
# Reset the Docker database after saving a backup in /app/data/backups.
# WARNING: clears accounts, sessions, predictions, and settlements.
# Usage: sudo bash scripts/recover_db.sh
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo 'Usage: sudo bash scripts/recover_db.sh' >&2
  exit 1
fi

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

if [[ ! -f .env ]]; then
  echo 'Missing .env. Configure the Docker deployment before running recovery.' >&2
  exit 1
fi

compose=(docker compose --project-directory "$root" --env-file "$root/.env" -f "$root/compose.yaml")
"${compose[@]}" config --quiet
docker info >/dev/null

echo 'Restarting the Docker app before database recovery...'
"${compose[@]}" restart app

# Restore service even if the maintenance command fails.
resume_app() {
  local result=$?
  trap - EXIT
  echo 'Starting the Docker app and checking health...'
  if ! "${compose[@]}" up -d --no-build --no-deps --wait --wait-timeout 120 app; then
    echo 'App startup failed. Inspect: sudo docker compose logs --tail=100 app' >&2
    exit 1
  fi
  if [[ $result -ne 0 ]]; then
    echo 'Database recovery failed; inspect the maintenance output above.' >&2
  fi
  exit "$result"
}
trap resume_app EXIT

echo 'Stopping the app to back up and reset its database...'
"${compose[@]}" stop app
"${compose[@]}" run --rm --no-deps app \
  python3 scripts/database.py reset --db /app/data/p60.sqlite3 --confirm-reset
echo 'Database reset complete. The backup path is printed above.'
