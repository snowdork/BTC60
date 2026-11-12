#!/usr/bin/env bash
# Use the same validated deployment path for initial startup and updates.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
exec bash "$root/scripts/restart-docker.sh" "$@"
