#!/usr/bin/env bash
# Stop every Predict60 runtime, preserving Docker containers and data volumes.
set -uo pipefail

if [[ $# -ne 0 ]]; then
  echo 'Usage: bash scripts/stop.sh' >&2
  exit 1
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
status=0

# Attempt every shutdown even if another runtime cannot be stopped.
bash "$script_dir/stop-docker.sh" || status=1

if command -v systemctl >/dev/null 2>&1; then
  if load_state=$(systemctl show predict60.service --property=LoadState --value 2>/dev/null); then
    if [[ -n $load_state && $load_state != not-found ]]; then
      echo 'Stopping predict60.service...'
      if ! systemctl stop predict60.service; then
        echo 'Cannot stop predict60.service. Retry with sudo.' >&2
        status=1
      fi
    fi
  elif [[ -d /run/systemd/system ]]; then
    echo 'Cannot check predict60.service. Check systemd access and retry.' >&2
    status=1
  fi
fi

bash "$script_dir/stop-server.sh" || status=1

if [[ $status -eq 0 ]]; then
  echo 'Predict60 stopped.'
else
  echo 'Predict60 shutdown incomplete; resolve the errors above and retry.' >&2
fi
exit "$status"
