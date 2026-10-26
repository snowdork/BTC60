#!/usr/bin/env bash
# Install HTTPS and boot-time startup for this existing VPS checkout.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/enable-vps.sh" >&2
  exit 1
fi
root=$(cd "$(dirname "$0")/.." && pwd -P)
owner=$(stat -c %U "$root")
if [[ $owner == root || ! $root =~ ^/[a-zA-Z0-9_./-]+$ ]]; then
  echo "Use a checkout owned by an unprivileged user, with only letters, digits, /, _, ., or - in its path." >&2
  exit 1
fi

# This legacy installer replaces the entire proxy configuration. Shared VPS
# deployments must merge site blocks manually instead of running this helper.
if [[ -f /etc/caddy/Caddyfile ]] && ! cmp -s "$root/deploy/Caddyfile" /etc/caddy/Caddyfile; then
  echo 'Existing Caddy configuration detected; refusing to replace shared sites. Follow deploy/VPS.md.' >&2
  exit 1
fi

apt-get update
apt-get install -y caddy
install -d -m 700 /etc/predict60
# Preserve supported settings from the existing server without displaying secrets.
python3 - "$root" <<'PY'
import os, pathlib, sys
root = pathlib.Path(sys.argv[1])
target = pathlib.Path('/etc/predict60/predict60.env')
allowed = {'P60_SIGNUP_CODE', 'PREDICT60_DB', 'P60_DB', 'BTC60_DB', 'OILPRICE_API_KEY',
           'TWELVE_DATA_API_KEY', 'TWELVEDATA_API_KEY'}
if not target.exists():
    settings = {}
    for proc in pathlib.Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / 'cmdline').read_bytes().split(b'\0')
            if str(root / 'src/backend/server.py').encode() not in args:
                continue
            for entry in (proc / 'environ').read_bytes().split(b'\0'):
                name, sep, value = entry.partition(b'=')
                if sep and name.decode() in allowed:
                    settings[name.decode()] = value.decode()
            break
        except (OSError, UnicodeError):
            continue
    def quote(value):
        if '\n' in value or '\r' in value:
            raise SystemExit('Unsupported newline in existing environment setting')
        return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
    settings.update(P60_HOST='https://predict60.com', P60_SECURE_COOKIES='true',
                    P60_TRUSTED_PROXIES='127.0.0.1,::1')
    target.write_text(''.join(k + '=' + quote(v) + '\n' for k, v in settings.items()))
    target.chmod(0o600)
PY
install -m 644 "$root/deploy/Caddyfile" /etc/caddy/Caddyfile.predict60
caddy validate --config /etc/caddy/Caddyfile.predict60 --adapter caddyfile
if [[ -f /etc/caddy/Caddyfile && ! -f /etc/caddy/Caddyfile.before-predict60 ]]; then
  cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-predict60
fi
install -m 644 /etc/caddy/Caddyfile.predict60 /etc/caddy/Caddyfile
bash "$root/deploy/install-service.sh" --start
if command -v ufw >/dev/null && ufw status | head -1 | grep -q 'Status: active'; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi
systemctl enable caddy
systemctl restart caddy
curl --fail --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:8000/healthz
curl --fail --retry 10 --retry-all-errors --retry-delay 3 --max-time 10 https://predict60.com/healthz
echo
echo 'Predict60 HTTPS is ready. Manage the app with: sudo systemctl restart predict60'
