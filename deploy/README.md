# VPS deployment

## Docker Compose deployment

Use [Docker deployment](DOCKER.md) for the supplied container setup. It includes
an app image, Caddy HTTPS, persistent SQLite and certificate volumes, bounded
logs, and `unless-stopped` crash recovery. Run one app instance. The app binds to
`0.0.0.0:8000` inside Docker, but Compose does not publish that port on the VPS.

From the repository root, after installing Docker Engine and Compose:

```bash
cp deploy/docker.env.example .env
chmod 600 .env
# Edit .env: set P60_DOMAIN to your domain, without https:// or a path.
sudo systemctl enable --now docker
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Point DNS at the VPS and make ports 80/443 available to Caddy. If Apache or a host
Caddy already uses those ports, resolve that conflict before starting this stack.
The Docker network must not overlap existing networks. Follow the Docker guide
for importing existing accounts **before first startup**; the image does not
include the checkout's local database. The Docker app explicitly uses
`/app/data/p60.sqlite3`, so an old filename must be imported under this name.

The `.env` configuration becomes the app environment; Caddy's fixed private IP
is the only trusted proxy. Do not copy the systemd loopback proxy setting into
Docker. Docker recovers exited processes; health checks report availability but
do not restart an unhealthy process that is still running. Enable Docker at boot
and verify recovery using the [test guide](../doc/TEST_GUIDE.md).

Back up before upgrades and copy backups off-host. Do not run
`docker compose down -v` during routine maintenance: it deletes persistent data.
Use the Docker guide's commands for backup, restore, logs, and image rollback.
The systemd backup timer below targets the host deployment and is not installed
or adapted automatically by Compose.

## Alternative: systemd deployment

The remaining instructions use systemd without Docker. Choose one process
supervisor for the app; do not run the host service or development watchdog
alongside the container against the same database.

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

## Contests and sponsors

Startup adds contest tables automatically; back up before upgrading. Sponsor
configuration and the local prize CLI are documented in
[contest operations](../doc/CONTEST_OPERATIONS.md). Prize pools are unconfigured
by default. Docker rebuilds must include the new contest module and admin script.
