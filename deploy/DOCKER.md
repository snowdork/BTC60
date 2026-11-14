# Docker deployment

Run one shared reverse proxy on the VPS for all projects. Predict60 publishes
HTTP only on `127.0.0.1:8085`; set `P60_PORT` in the project's `.env` to change it.
Phunky uses `127.0.0.1:8086` and `https://phunk.free-vibe.com`.
Other shared applications have their own ports; see [the shared address plan](VPS.md).
Each project needs a distinct Compose project name and non-overlapping network.
Predict60 keeps its existing `p60` project and data volume.

Point both `predict60.com` and `predict60.free-vibe.com` DNS records at the VPS.
Merge `deploy/Caddyfile.vps` into the **host's shared Caddy configuration**, then
validate and reload Caddy. It serves HTTPS for both domains and proxies to 8085.
See [shared HTTPS installation and verification](VPS.md#shared-https-configuration)
for the backup, install, and reload commands. Rebuilding the app does not update
the host proxy. Run `bash deploy/check-vps.sh` after deployment to verify both
Predict60 domains and Phunky through public HTTPS.
When changing `P60_PORT`, update the proxy upstream too: Compose's `.env` does
not set the host Caddy service environment. Set that service's `P60_PORT` or edit
the upstream in its configuration. Keep the existing shared site's blocks.
Google OAuth Authorized JavaScript origins must include both HTTPS origins.
Configure them under [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients).
Accounts share the database; browser login cookies are separate per hostname.

For password signup/login and Google authentication at `http://localhost:8085`
on this same stack, add that exact
origin to the existing comma-separated `P60_ADDITIONAL_ORIGINS` in `.env`:

```dotenv
P60_ADDITIONAL_ORIGINS=https://predict60.free-vibe.com,http://localhost:8085
```

From the project root, apply the setting by recreating the app container:

```bash
sudo docker compose --env-file .env -f compose.yaml up -d --no-build --wait app
```

This preserves the database volume. Refresh the signup/login page after the app
is healthy. Restarting the existing container alone does not load changed Compose
environment settings. This origin-only change requires no image rebuild.
Keep `P60_HOST` on the public HTTPS origin and keep the existing aliases.
Authorize `http://localhost:8085` in Google's web client settings as well.
An `Invalid request origin.` response from signup, login, Google authentication,
or another browser POST means the browser origin is missing from the app's
allowlist. An origin includes scheme, hostname, and port, without a path:
`http://localhost:8085/signup.html` needs `http://localhost:8085`.
`http://127.0.0.1:8085` is a different origin and needs its own explicit entry if
used. Preserve existing public aliases; do not disable origin checks or use a
wildcard. For a separate local
development container, use [local Docker mode](LOCAL.md#docker).

Existing deployments: stop the old stack's Caddy with `docker compose stop caddy`
**before updating the checkout**, then let the shared host proxy own 80/443.
After updating, remove the stopped old proxy with `docker compose up -d --remove-orphans`.
Do not remove volumes. Existing app data and old certificate volumes are retained.
The app trusts the host via Docker gateway `172.30.60.1`; keep that subnet free.

```bash
bash scripts/setup-vps.sh
sudo systemctl enable --now docker
bash deploy/start-docker.sh
docker compose logs --tail=100 app
```

See [guided setup](SETUP.md) for saved-profile checks, updates, and automation.

Restart helpers use a shared `.docker-restart.lock` in this checkout. If another
restart is in progress, the second exits before any Docker or service changes;
wait for the first to finish, then retry. The operating system releases the lock
when the helper exits, including failures. Do not delete the lock file while a
restart is running. Direct `docker compose` commands do not acquire this lock;
avoid running them during a helper restart.

A container-name conflict involving `p60-app-1` and a temporary name such as
`b66613c94523_p60-app-1` can occur when two Compose replacements overlap. Wait
for the active operation, then check `sudo docker compose ps` and retry the
restart helper if needed. Keep the database volume; a transient name conflict
does not require resetting accounts or removing volumes.


`start-docker.sh` delegates to `scripts/restart-docker.sh --recreate`; both can
be called from any directory. They explicitly use this checkout's `compose.yaml`
and `.env`, validate Compose without printing secrets, and check daemon access.
Recreation builds the app and waits up to 120 seconds for service readiness. Use a recent
Compose plugin supporting `up --wait`. If startup fails, containers remain
available for log inspection; correct the problem and rerun the command. App
startup does not verify public DNS or certificate issuance, so check the public
HTTPS endpoint separately. After a successful build, the helper stops an installed
`predict60.service` before starting the container; run with `sudo` when required.
It does not import an existing database; complete the data import below before
first startup if needed.

The shared host proxy provides HTTPS and sends a single `X-Forwarded-For`
address. The app port stays on loopback. The image runs as user 10001; Docker
restarts exited containers with `unless-stopped`. Keep one app replica and do
not run the host app service against the same database.

VPS builds use `p60:${P60_IMAGE_TAG}` (default `p60:local`). Local development
uses `p60:local-dev`, so rebuilding a local image cannot replace the VPS image
tag. Set `GOOGLE_CLIENT_ID` in the selected environment file; the server supplies
the same ID to the login, signup, and account-linking pages and verifies tokens
against it. No frontend edits or client secret are required.

`P60_ADDITIONAL_ORIGINS` accepts exact origins separated by commas. Set it to
an empty value to remove all aliases, or list only the aliases this deployment
serves. Google must authorize every origin on which its sign-in button is used.

The image health check probes `/healthz`. An unhealthy status alone does not
restart a running container; monitor public HTTP availability separately.
See [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/).

## Data and upgrades

To restart the existing VPS app with its current image and configuration:

```bash
sudo bash scripts/restart-docker.sh
```

To build an updated image and recreate the VPS app after code or environment changes:

```bash
sudo bash scripts/restart-docker.sh --recreate
```

The default never builds or creates containers. If the app container is missing,
it exits with instructions to use `--recreate`. Both paths check app readiness.

After a successful build, the restart helper stops `predict60.service` when it
is installed, before replacing/starting the Docker app. Run the helper with
`sudo` for this handoff. If stopping the service fails, Docker replacement is
aborted. A failed build leaves the host service running. Stopping the service
does not disable its boot startup; use `sudo systemctl disable predict60` if
Docker will permanently replace the host service.

### Switching to the host server

For the development watchdog, run `python3 scripts/restart-server.py` from the
checkout. It stops the `p60-local` container and all containers in the `p60` and
`p60-local` Compose projects before starting Python. Containers
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
not automatically imported into the host database. The shared host proxy continues serving other projects.

### Rebuild behavior and persistent data

Run `sudo bash scripts/restart-docker.sh --recreate` after updating the checkout and making
a database backup. The script
uses the VPS `compose.yaml` and `.env`, checks configuration and Docker access
before building, and retains all database and certificate volumes. Existing
containers continue serving during the build. If the build fails, they remain
untouched. After a successful build, Compose forcibly recreates only the app and
waits for readiness. Without `--recreate`, the helper restarts the existing app
without applying image or environment changes. Expect a brief interruption when an app instance is
replaced; this is not a zero-downtime deployment. The shared host proxy continues running. It does not restart the Docker daemon or
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

Registration requires no code by default. The optional invite-code policy lives
in `src/backend/CONST.py`; see [registration protections](SETUP.md#registration-abuse-controls).
To enable invite codes, set `SIGNUP_CODE_REQUIRED = True` and set
`P60_SIGNUP_CODE` in the private environment file. With the gate enabled,
unset/empty codes disable new signups with HTTP 503; existing users can still
log in. The expected code is never included in public assets or API responses.

For Docker, edit the root `.env` and run `docker compose up -d` to recreate the
app with the new environment. For systemd, edit `/etc/predict60/predict60.env`
and restart `predict60.service`. A local `python3 src/backend/server.py` process needs the
variable exported in its shell; it does not automatically load `.env`.

## Routine operation

Run from the checkout containing `.env`. Use `sudo` if Docker requires it.

```bash
# Status and bounded log inspection
docker compose ps
docker compose logs --tail=100 app
docker stats --no-stream

# Apply application code changes after taking a backup
bash scripts/restart-docker.sh --recreate

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
