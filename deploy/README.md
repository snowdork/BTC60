# VPS deployment

For the container deployment with Docker crash recovery and Caddy, see
[Docker deployment](DOCKER.md). The instructions below use systemd without Docker.

Predict60 runs on loopback behind Caddy. Systemd replaces the development
watchdog, restarts the process, and captures stdout/stderr in the journal.

## Preflight

1. Revoke and rotate every credential that has ever been committed, especially
   the old `oilpriceapi.key`. Removing the file from Git does not revoke it.
2. Deploy a clean, tagged release to `/opt/predict60/releases/<tag>` and point
   `/opt/predict60/current` at it. Keep mutable state outside the release.
3. Create the `predict60` system account and install the tmpfiles, service,
   timer, environment, and Caddy configurations from this directory.
4. Set `/etc/predict60/predict60.env` to `root:predict60` mode `0640`. Provider
   credentials belong only in that file or an equivalent secret manager.
5. Apply OS updates and verify the host/provider firewalls allow only SSH, 80,
   and 443. Port 8000 must remain private.

## Database and first start

Before starting or upgrading, initialize or migrate the database explicitly:

```bash
sudo -u predict60 env PREDICT60_DB=/var/lib/predict60/p60.sqlite3 \
  python3 /opt/predict60/current/scripts/database.py init
sudo systemctl enable --now predict60.service predict60-backup.timer
curl --fail http://127.0.0.1:8000/healthz
```

Before every later migration, run `scripts/database.py backup` and copy the
result off the VPS. The included timer creates local recovery copies; it is not
an off-site backup by itself.

## Proxy and DNS cutover

Install the Caddyfile only after replacing its hostname if necessary. Caddy
overwrites `X-Forwarded-For` with a single client address, matching the app's
`P60_TRUSTED_PROXIES=127.0.0.1,::1` setting.

Point the domain A record at the VPS, open ports 80/443, validate the Caddy
configuration, and reload Caddy. Do not publish an AAAA record until public IPv6
works on the host.

## Verification

```bash
systemctl status predict60 caddy
systemctl status predict60-backup.timer
journalctl -u predict60 -n 100 --no-pager
curl --fail https://predict60.com/healthz
curl -I https://predict60.com/
```

Verify that login and logout cookies contain `Secure`, `HttpOnly`, and
`SameSite=Lax`; HTTP redirects to HTTPS; port 8000 is unreachable publicly; and
signup, login, prediction, settlement, restart persistence, backup, and restore
all work through the public hostname.

Public self-service accounts still need an email provider and product decisions
for address verification and password recovery. Until those exist, treat the
deployment as a controlled beta rather than unrestricted public signup.
