# Docker deployment

Run these commands from the repository root. Install Docker Engine and the
Compose plugin first. Point your domain at the VPS and allow inbound TCP 80/443
plus your SSH port. Stop any existing service using ports 80/443 before starting
Caddy. The Docker subnet 172.30.60.0/24 must not overlap an existing network;
if changed, update both container addresses and P60_TRUSTED_PROXIES together.
The app uses 172.30.60.3 and Caddy uses 172.30.60.2. Both are explicit so the
app cannot automatically receive Caddy's address when it starts first.

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

To build an updated image and recreate changed VPS containers:

```bash
sudo bash scripts/restart-docker.sh
```

After a successful build, the restart helper stops `predict60.service` when it
is installed, before replacing/starting the Docker app. Run the helper with
`sudo` for this handoff. If stopping the service fails, Docker replacement is
aborted. A failed build leaves the host service running. Stopping the service
does not disable its boot startup; use `sudo systemctl disable predict60` if
Docker will permanently replace the host service.

### Switching to the host server

For the development watchdog, run `python3 scripts/restart-server.py` from the
checkout. It stops the `p60-local` container and all containers in the `p60` and
`p60-local` Compose projects, including Caddy, before starting Python. Containers
and volumes are retained; unrelated containers and the Docker daemon keep
running. If Docker cannot be checked or stopped, host startup aborts. See
[local switching instructions](LOCAL.md#switching-between-python-and-docker)
for permissions, data locations, and switching back.

For systemd, stop the stack explicitly before starting the host service:

```bash
docker compose stop
sudo systemctl start predict60
```

Use `sudo` for Docker commands if your installation requires it. Stop any local
Docker deployment as well (`docker stop p60-local`). Systemd startup and direct
Python startup do not call the restart script's Docker shutdown. Docker data is
not automatically imported into the host database. Stopping the stack also stops
its HTTPS proxy; configure the host's HTTPS proxy before serving public traffic.

### Rebuild behavior and persistent data

Run `sudo bash scripts/restart-docker.sh` after updating the checkout and making
a database backup. The script
uses the VPS `compose.yaml` and `.env`, checks configuration and Docker access
before building, and retains all database and certificate volumes. Existing
containers continue serving during the build. If the build fails, they remain
untouched. After a successful build, Compose recreates changed services and waits
for readiness. Expect a brief interruption while the single app instance is
replaced; this is not a zero-downtime deployment. Caddy is left running unless its
configuration changed. It does not restart the Docker daemon or
stop unrelated containers. This command does not use `compose.local.yaml`.

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
and restart `predict60.service`. A local `python3 src/backend/server.py` process needs the
variable exported in its shell; it does not automatically load `.env`.

## Routine operation

Run from the checkout containing `.env`. Use `sudo` if Docker requires it.

```bash
# Status and bounded log inspection
docker compose ps
docker compose logs --tail=100 app caddy
docker stats --no-stream

# Apply application code changes after taking a backup
bash scripts/restart-docker.sh

# Apply .env changes without rebuilding the image
docker compose up -d --no-build --wait --wait-timeout 120

# Stop intentionally; keep all volumes
docker compose stop
# Resume
docker compose up -d --no-build --wait --wait-timeout 120
```

`docker compose restart` restarts the existing container; it does **not** apply
changed environment variables. `up` recreates containers when their configuration
or image changes ([Compose up](https://docs.docker.com/reference/cli/docker/compose/up/),
[Compose restart](https://docs.docker.com/reference/cli/docker/compose/restart/)).
A failed readiness check leaves containers available for diagnosis and does not
roll back the image or database automatically.

For an image rollback, set `P60_IMAGE_TAG` back to the retained tag and use
`docker compose up -d --no-build --wait --wait-timeout 120`. Do not run a build
against the old tag: that would overwrite it with the current checkout. Restore
the matching backup first if the older code cannot read the migrated schema.

Review disk usage with `df -h` and `docker system df`. Copy backups off-host and
remove expired backups according to your retention policy; neither Docker log
rotation nor the app removes database backups. Keep the last known-good image.
Avoid volume pruning on a deployment that stores its accounts in Docker volumes.
