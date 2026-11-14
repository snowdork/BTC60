#!/usr/bin/env bash
# Configure the local testing profile; pass --start to build and launch Docker.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec bash "$script_dir/setup-env.sh" --local "$@"
