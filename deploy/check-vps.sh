#!/usr/bin/env bash
# Read-only checks for the default shared host-Caddy deployment.
set -uo pipefail

failed=0
check() {
  local url=$1
  if curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
      --output /dev/null "$url"; then
    printf 'PASS %s\n' "$url"
  else
    printf 'FAIL %s\n' "$url" >&2
    failed=1
  fi
}

check "http://127.0.0.1:${P60_PORT:-8085}/healthz"
check "http://127.0.0.1:${PHUNK_PORT:-8086}/version.json"
check https://predict60.com/healthz
check https://predict60.free-vibe.com/healthz
check https://phunk.free-vibe.com/version.json
exit "$failed"
