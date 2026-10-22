# VPS and local operation

## Choose an operating mode

| Environment | Start/update | Persistent data | Logs |
| --- | --- | --- | --- |
| Local Python | `python3 src/backend/server.py` | `data/p60.sqlite3` by default | Terminal |
| Local Docker, no Compose | `bash scripts/restart-docker.sh --local` | `p60-local-data` volume | `docker logs p60-local` |
| Local Compose | `docker compose -f compose.local.yaml --env-file .env.local up -d --build` | `p60-local-data` volume | Compose logs |
| VPS Docker + HTTPS | `bash deploy/start-docker.sh` initially; `bash scripts/restart-docker.sh` for updates | Compose `p60-data` volume | Compose logs |
| VPS systemd + HTTPS | `sudo systemctl restart predict60` | Configured database path | systemd journal |

Use one supervisor per deployment and one app process per database. Local Docker
and local Compose share a volume/container name: stop the previous mode before
switching. See [local operation](LOCAL.md) for setup, backups, and troubleshooting,
and [Docker operation](DOCKER.md) for VPS upgrades and rollback.

Python serves the files in `src/frontend/`; server code lives in `src/backend/`.
Docker copies the `src/` tree into the image.
`dist/` is only a static export; editing it does not update the running app.
After source changes, regenerate it with `python3 scripts/build-static.py` if you
need a synchronized export. Static hosting alone cannot run accounts or trading.

## VPS capacity and upkeep

Keep the default 32 request handlers initially. Measure memory, CPU, HTTP 503s,
response latency, disk space, and settlement delay before changing
`P60_MAX_REQUESTS`. Increasing handlers can worsen SQLite writer contention and
provider throttling. Do not add app replicas against the same SQLite database.
The existing server is a bounded Python HTTP server behind Caddy, not a measured
high-traffic platform; see the [performance review](../doc/VPS_PERFORMANCE.md).

Keep Python, Docker, Caddy, and the OS patched. For container base-image updates,
use `docker compose build --pull app` and `docker compose pull caddy`, then
`docker compose up -d --no-build --wait --wait-timeout 120`, with a database backup
and retained image tag first. Health checks verify the app/database, not provider
freshness or successful settlement: check those in the UI after each deployment.



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
bash deploy/start-docker.sh
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

## Install only the app service

From an existing checkout owned by an unprivileged user on a systemd Linux host:

```bash
sudo bash deploy/install-service.sh
sudoedit /etc/predict60/predict60.env
sudo bash deploy/install-service.sh --start
```

The first command installs and enables `predict60.service` for boot without
starting it. Set `P60_SIGNUP_CODE` in the private environment file to enable
signup, and copy any provider credentials or custom database path used by your
existing process. Existing environment files are preserved. With no explicit
database path, the service uses this checkout's existing default database.
For HTTPS, apply the origin, secure-cookie, and proxy settings from
`predict60.env.example` once your reverse proxy is configured.

The `--start` command stops this checkout's development watchdog and restarts the
service, then checks `/healthz`. Stop any Docker deployment before switching to
this service; see [switching to the host server](DOCKER.md#switching-to-the-host-server)
for shutdown commands and data considerations. The installer does not install packages or change Caddy or firewall
rules. It binds to `127.0.0.1:8000`; use your reverse proxy for public access.
Keep the checkout at its installed path. The unit runs `src/backend/server.py` directly as
the checkout owner, retries crashes every five seconds, and logs to the journal.

```bash
sudo systemctl start predict60
sudo systemctl stop predict60
sudo systemctl restart predict60
sudo systemctl status predict60
sudo journalctl -u predict60 -f
```

On systemd hosts, `sudo service predict60 start` (and `stop`, `restart`, or
`status`) also works. To disable boot startup and stop it:
`sudo systemctl disable --now predict60`.

## Enable HTTPS for an existing checkout

For an existing checkout on an apt-based Linux VPS with systemd, the helper
below installs Caddy and enables app startup at boot:

```bash
sudo bash deploy/enable-vps.sh
```

The checkout must belong to an unprivileged user and its path must contain no
characters other than letters, digits, `/`, `_`, `.`, or `-`. The helper targets **predict60.com**: point DNS at this
VPS and make ports 80/443 available before running it. For another domain, adapt
both `deploy/Caddyfile` and the helper’s `P60_HOST` and HTTPS health-check URL
first. Resolve existing services using ports 80/443.

The helper replaces `/etc/caddy/Caddyfile`, saving its first existing version as
`/etc/caddy/Caddyfile.before-predict60`, and writes
`/etc/systemd/system/predict60.service`. The service runs as the checkout owner,
binds to `127.0.0.1:8000`, uses normal logging, and restarts on failure. It stops
this checkout’s development watchdog before starting systemd.

If `/etc/predict60/predict60.env` does not exist, the helper creates it with mode
0600, setting the HTTPS origin, Secure cookies, and loopback trusted proxies. It
attempts to preserve database-path and provider-key variables from a process
whose command line contains this checkout’s absolute `src/backend/server.py` path. A process
started as `python3 src/backend/server.py` may not match. Verify the database path and keys
manually; an existing environment file is left unchanged. **`P60_SIGNUP_CODE` is
not copied**: set it explicitly in that private file to enable new signups.
Restart the service after editing the file.

```bash
sudo systemctl restart predict60
sudo systemctl status predict60 caddy
sudo journalctl -u predict60 -n 100 --no-pager
```

The helper opens ports 80/443 only when UFW is already active; configure provider
firewalls separately. It checks loopback and public HTTPS `/healthz` endpoints.
It does not install the backup timer or move the database out of the checkout.
Use systemctl for this deployment’s lifecycle and the journal for logs. The
release-directory setup below is a separate, manually configured option.

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

## Signup code configuration

Set `P60_SIGNUP_CODE` in the private environment file. There is no built-in
default: unset or empty values disable new signups with HTTP 503; existing users
can still log in. The code is checked server-side and is not included in public
assets or API responses.

For Docker, edit the root `.env` and run `docker compose up -d` to recreate the
app with the new environment. For systemd, edit `/etc/predict60/predict60.env`
and restart `predict60.service`. A local `python3 src/backend/server.py` process needs the
variable exported in its shell; it does not automatically load `.env`.
