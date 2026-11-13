#!/usr/bin/env bash
# Configure VPS or local Docker without starting services or changing databases.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec python3 "$script_dir/setup_env.py" "$@"
