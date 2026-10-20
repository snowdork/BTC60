#!/usr/bin/env bash
# Install boot startup for an existing checkout without changing HTTPS or firewalls.
set -euo pipefail
if [[ $# -gt 1 || (${1:-} != '' && ${1:-} != '--start') ]]; then
  echo 'Usage: sudo bash deploy/install-service.sh [--start]' >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo 'Run with sudo: sudo bash deploy/install-service.sh [--start]' >&2
  exit 1
fi
root=$(cd "$(dirname "$0")/.." && pwd -P)
owner=$(stat -c %U "$root")
group=$(stat -c %G "$root")
if [[ $owner == root || ! $root =~ ^/[a-zA-Z0-9_./-]+$ ]]; then
  echo 'Use a checkout owned by an unprivileged user, with only letters, digits, /, _, ., or - in its path.' >&2
  exit 1
fi
command -v systemctl >/dev/null
command -v systemd-analyze >/dev/null
[[ -d /run/systemd/system ]] || { echo 'This installer requires a host running systemd.' >&2; exit 1; }
runuser -u "$owner" -- test -r "$root/server.py"
install -d -m 700 /etc/predict60
if [[ ! -e /etc/predict60/predict60.env ]]; then
  # Preserve the checkout's database selection, including the legacy filename.
  # Configure HTTPS settings separately when a reverse proxy is ready.
  install -m 600 /dev/null /etc/predict60/predict60.env
  cat > /etc/predict60/predict60.env <<'ENV'
# Private configuration. Restart predict60 after changing this file.
# Defaults to this checkout's data/p60.sqlite3 (or its existing legacy database).
# Set PREDICT60_DB explicitly if your existing process uses another database.
# PREDICT60_DB=/absolute/path/to/p60.sqlite3
# Empty disables signup; existing users can still log in.
P60_SIGNUP_CODE=
# For HTTPS deployment, use the settings in deploy/predict60.env.example.
ENV
fi
unit_dir=$(mktemp -d)
trap 'rm -rf "$unit_dir"' EXIT
python3 - "$root" "$owner" "$group" "$unit_dir/predict60.service" <<'PY'
from pathlib import Path
import sys
root, owner, group, destination = sys.argv[1:]
unit = (Path(root) / 'deploy/predict60-checkout.service.in').read_text()
for token, value in (('@ROOT@', root), ('@USER@', owner), ('@GROUP@', group)):
    unit = unit.replace(token, value)
Path(destination).write_text(unit)
PY
systemd-analyze verify "$unit_dir/predict60.service"
install -m 644 "$unit_dir/predict60.service" /etc/systemd/system/predict60.service
systemctl daemon-reload
systemctl enable predict60.service
if [[ ${1:-} == --start ]]; then
  # Hand over supervision; never run the watchdog and service together.
  runuser -u "$owner" -- python3 "$root/scripts/stop-server.py"
  systemctl restart predict60.service
  curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 --max-time 5 http://127.0.0.1:8000/healthz
  echo
else
  echo 'Installed and enabled for boot. Review /etc/predict60/predict60.env, then run this installer with --start.'
fi
echo 'Manage with: sudo systemctl start|stop|restart|status predict60'
echo 'Logs: sudo journalctl -u predict60 -f'
