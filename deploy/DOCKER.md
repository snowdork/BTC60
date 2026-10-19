# Docker deployment

Run these commands from the repository root. Install Docker Engine and the
Compose plugin first. Point your domain at the VPS and allow inbound TCP 80/443
plus your SSH port. Stop any existing service using ports 80/443 before starting
Caddy. The Docker subnet 172.30.60.0/24 must not overlap an existing network;
if changed, update both Caddy's fixed address and P60_TRUSTED_PROXIES together.

```bash
cp deploy/docker.env.example .env
chmod 600 .env
# Edit .env and set P60_DOMAIN to your real domain.
sudo systemctl enable --now docker
bash deploy/start-docker.sh
docker compose logs --tail=100 app caddy
```

`start-docker.sh` can be called from any directory. It requires the repository’s
`.env`, validates Compose without printing secrets, checks daemon access, builds
the images, and waits up to 120 seconds for service readiness. Use a recent
Compose plugin supporting `up --wait`. If startup fails, containers remain
available for log inspection; correct the problem and rerun the command. Caddy
startup does not verify public DNS or certificate issuance, so check the public
HTTPS endpoint separately. The helper does not stop host services or import an
existing database; complete the data import below before first startup if needed.

Caddy provides HTTPS and forwards to the private app port 8000. No app port is
published on the host. The image runs Python directly as user 10001; Docker
restarts exited containers with `unless-stopped`. Intentional stops remain
stopped, including after reboot. Do not run the development watchdog or the
existing predict60 systemd app service alongside this stack. Keep one app replica.

The image health check probes `/healthz`. An unhealthy status alone does not
restart a running container; monitor public HTTP availability separately.
See [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/).

## Data and upgrades

The `p60-data` named volume persists `/app/data`, including SQLite and optional
`odds-calibration.json`. The image never includes your local database or secrets.
The first start creates a new database unless you import an existing backup.
Never use `docker compose down -v` unless intentionally deleting all stored data
and certificates.

To import existing accounts before first startup, make a consistent backup with
`scripts/database.py backup` in the old installation. Then, after building:

```bash
docker compose build app
docker compose create app
docker compose cp /path/to/backup.sqlite3 app:/app/data/p60.sqlite3
docker compose run --rm --no-deps --user root app chown 10001:10001 /app/data/p60.sqlite3
docker compose up -d
```

For an already-running deployment, stop the app before restoring data. Do not
replace a live SQLite database or leave stale WAL/SHM files from an older database;
restore into an empty data volume after preserving the original for rollback.

Create a consistent online backup and copy the reported backup filename off-host:

```bash
docker compose exec app python3 scripts/database.py backup
# Use the exact filename printed above:
docker compose cp app:/app/data/backups/REPLACE_WITH_FILENAME.sqlite3 ./
```

Schedule backups on the host and test restoration. Before every upgrade, back up
the database, retain the previous image tag, set a new P60_IMAGE_TAG in .env, and
run `bash deploy/start-docker.sh`. Startup applies database migrations. Rolling
back an image may also require restoring its pre-upgrade database backup.

## Verification and recovery

Verify `https://YOUR_DOMAIN/healthz`, signup/login, prediction placement,
settlement, and persistence after `docker compose restart app` and a VPS reboot.
Check that cookies are Secure and port 8000 is not publicly reachable.

On a disposable deployment, after the app has run for at least ten seconds,
simulate a process crash with:

```bash
docker compose exec app python3 -c 'import os, signal; os.kill(1, signal.SIGKILL)'
# The exec command may report an error because its container exited.
docker compose ps
docker compose logs --tail=30 app
```

Docker should restart the app. To stop intentionally use `docker compose stop`;
resume with `docker compose up -d`. Existing email verification and account
recovery limitations still apply; see the main VPS guide.

## Contests and sponsors

Startup adds contest tables automatically; back up before upgrading. Sponsor
configuration and the local prize CLI are documented in
[contest operations](../doc/CONTEST_OPERATIONS.md). Prize pools are unconfigured
by default. Docker rebuilds must include the new contest module and admin script.

## Request capacity

`P60_MAX_REQUESTS` defaults to 32 simultaneous app HTTP handlers (allowed 1–256).
Overload returns HTTP 503 with Retry-After. Raise the limit only after measuring
VPS memory, latency, and provider limits. The app tmpfs is capped at 64 MiB.
See the [performance review](../doc/VPS_PERFORMANCE.md) for measurements and limits.

## Signup code configuration

Set `P60_SIGNUP_CODE` in the private environment file. There is no built-in
default: unset or empty values disable new signups with HTTP 503; existing users
can still log in. The code is checked server-side and is not included in public
assets or API responses.

For Docker, edit the root `.env` and run `docker compose up -d` to recreate the
app with the new environment. For systemd, edit `/etc/predict60/predict60.env`
and restart `predict60.service`. A local `python3 server.py` process needs the
variable exported in its shell; it does not automatically load `.env`.
