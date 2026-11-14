#!/usr/bin/env bash
# Back up and empty the VPS Docker database, then restart after success.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec python3 "$script_dir/reset_profile_database.py" --vps "$@"
