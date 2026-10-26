# Local operation

Run commands from the repository root. Python 3.10+ and internet access are
required for live feeds. Google sign-in needs the Python packages in `requirements.txt`. Node.js
is needed for JavaScript tests. The full test runner and watchdog target Linux.

## Python

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

# Read a signup code without storing it in shell history (Bash).
read -rs -p 'Local signup code: ' P60_SIGNUP_CODE
export P60_SIGNUP_CODE
.venv/bin/python src/backend/server.py --bind 127.0.0.1 --port 8000
```

The restart helper automatically uses `.venv/bin/python` when it exists.
For Google testing, use `http://localhost:8000` and register that origin in Google.

Open http://127.0.0.1:8000. Stop with Ctrl-C; restart after Python changes.
Refresh the browser after HTML/CSS/JS changes. An empty signup code disables new
signups but existing accounts can log in. Python does not read `.env` files.
Leave `P60_HOST` unset for the default local HTTP origin, or set it to the exact
origin you use. Do not carry the production HTTPS origin into a local session.

The default database is `data/p60.sqlite3` (an existing legacy `btc60.sqlite3`
remains supported). `PREDICT60_DB` overrides it. Inspect the effective database
and create a consistent backup using the same environment as the server:

```bash
python3 scripts/database.py status
python3 scripts/database.py backup
```

For a Linux background watchdog:

```bash
python3 scripts/restart-server.py
scripts/stop-server.sh
```

Use these instead of running a second direct process. Logs rotate under
`/tmp/p60`; the watchdog is not a boot-time service. See the main README for log
levels. For startup at boot on a VPS use systemd or Docker.

### Switching between Python and Docker

`python3 scripts/restart-server.py` stops the `p60-local` container and all
containers in the `p60` and `p60-local` Compose projects before starting Python.
The shared host Caddy proxy continues running. It preserves containers and data
volumes, leaves unrelated Docker applications running, and does not stop the
Docker daemon. No Compose plugin or `.env` file is needed for this shutdown.

If Docker is not installed, Python starts normally. If Docker is installed but
the daemon cannot be reached or a container cannot be stopped, the restart aborts
before changing the existing Python processes. Check `docker info` and restore
daemon access or Docker permissions, then retry as your usual server user.
The stopped containers remain stopped after reboot unless explicitly started.

Before switching back to Docker, run `scripts/stop-server.sh` to stop
the watchdog. The Docker restart helper stops an installed `predict60.service`,
but does not stop the development watchdog. Direct Python, `docker start`,
Compose commands, and systemd commands do not perform this automatic Docker
shutdown; stop the previous deployment before using them.

Switching modes does not copy data: Python uses the checkout database, while
local Docker uses `p60-local-data`. Back up and explicitly import data if you
need the same accounts in another deployment.

## Docker

```bash
cp -n deploy/local.env.example .env.local
chmod 600 .env.local
# Edit .env.local; change the example signup code if desired.
bash scripts/restart-docker.sh --local
```

After a successful build, the restart helper stops `predict60.service` when it
is installed, before replacing/starting the Docker app. Run the helper with
`sudo` for this handoff. If stopping the service fails, Docker replacement is
aborted. A failed build leaves the host service running. Stopping the service
does not disable its boot startup; use `sudo systemctl disable predict60` if
Docker will permanently replace the host service.


Open **http://localhost:8085** (use this hostname to match the configured origin).
This path needs Docker Engine but not Compose. It builds before replacing the
container, keeps accounts in `p60-local-data`, limits logs, and uses a read-only
root filesystem with a writable data volume and 64 MiB temporary filesystem.

```bash
docker logs --tail=100 -f p60-local
docker stop p60-local
docker start p60-local
docker exec p60-local python3 scripts/database.py backup
# Copy the exact backup filename printed by the preceding command:
docker cp p60-local:/app/data/backups/REPLACE_WITH_FILENAME.sqlite3 ./
```

Re-run the helper to apply code or `.env.local` changes. `docker start` resumes
its existing image and environment. Local Docker does not use the checkout's
SQLite file. For Compose instead:

```bash
docker compose -f compose.local.yaml --env-file .env.local up -d --build --wait
docker compose -f compose.local.yaml --env-file .env.local logs --tail=100 app
docker compose -f compose.local.yaml --env-file .env.local down
```

Choose one local Docker mode. Before switching, stop/remove the old container
without deleting its volume (`docker stop p60-local`, then `docker rm p60-local`
when switching from plain Docker; use Compose `down` for the reverse direction).
Never append `--volumes` to routine shutdown commands.

## Stop and reset commands

Use `scripts/stop.sh` to stop Predict60 Docker containers, `predict60.service`
when installed, and this checkout's Python server/watchdog. It attempts every
shutdown even if one fails, and exits nonzero if any shutdown fails. Run
`sudo bash scripts/stop.sh` if Docker or systemd requires elevated permissions.
Containers and volumes are preserved; the Docker daemon and unrelated containers
keep running. It stops the service without disabling boot startup.

```bash
scripts/stop-server.sh  # Stop this checkout's Python server and watchdog.
scripts/stop-docker.sh  # Stop Predict60 Docker containers, including Compose Caddy.
```

`stop-docker.sh` preserves containers and volumes and leaves unrelated containers
and the Docker daemon running. It needs the same Docker access as the restart
helper. `stop-server.sh` does not stop an installed systemd service; use
`sudo systemctl stop predict60` for that deployment.

To reset a host database, stop its server first, then run:

```bash
scripts/stop-server.sh
scripts/reset-database.sh --local --confirm-reset
# Or select an explicit database:
# scripts/reset-database.sh --local --db /path/to/p60.sqlite3 --confirm-reset
```

Reset backs up an existing database under its adjacent `backups/` directory,
clears users, sessions, predictions, and settlements, and restores seeded
catalogs. It prints the exact database path and verifies that user/session/prediction/settlement
counts are zero. The selected database must already exist. It requires `--confirm-reset` and refuses to reset a database held by
a running server. With `--local`, it uses `PREDICT60_DB` or the default checkout database, does
not read `.env` files, and does not reset a Docker volume's database. Run
`python3 scripts/restart-server.py` afterward when ready to resume.

## Checks and common problems

```bash
curl --fail http://127.0.0.1:8000/healthz  # Python
curl --fail http://localhost:8085/healthz # Docker
python3 scripts/run_tests.py
```

- Signup unavailable: set a nonempty `P60_SIGNUP_CODE` and restart/recreate.
- Origin rejected: use the configured hostname, scheme, and port exactly.
- Port in use: stop the other process/supervisor or choose another Python port.
- Changes missing in Docker: rebuild the image; editing `dist/` has no effect.
- Missing history or settlement delays: check connectivity and provider errors;
  health status does not establish provider availability.
- Docker unavailable: check `docker info`; use `sudo` if required by your setup.
  The plain-Docker helper works when the Compose plugin is missing.

### Reset a deployed database

Docker is the default runtime. Use `--service` for systemd or `--local` for the
checkout database; there is no fallback to a different runtime if Docker fails:

```bash
sudo scripts/reset-database.sh --service --confirm-reset
# Or Docker (use sudo if required for Docker access):
scripts/reset-database.sh --confirm-reset  # Docker by default
# If multiple Predict60 app containers exist:
scripts/reset-database.sh --docker --container p60-local --confirm-reset
```

`--service` reads `predict60.service`'s working directory, configured database
variables, and environment files. It stops the service and runs its maintenance
script as the service user. Run it with sudo to read private configuration and
switch users. The service remains stopped; resume with
`sudo systemctl start predict60`.

`--docker` finds an existing Predict60 app container, including stopped ones,
stops it, and runs a temporary maintenance container using its image, user,
database environment, and mounted data volumes. It does not need Compose or an
`.env` file. If more than one app container exists, select one with `--container`.
The app remains stopped, including after a reset failure; resume with
`docker start CONTAINER_NAME`. The backup stays in the data volume beside the
database under `backups/`. Other containers, including Caddy, keep running.

Reset always requires `--confirm-reset`. `--docker`, `--service`, and `--local`
are mutually exclusive; omitting them selects Docker. `--db PATH` overrides the
database path inside the selected runtime, so a host path requires `--local`
or `--service`. `--local` uses the checkout database and current environment.
Reset prints the exact selected path and verifies zero users, sessions,
predictions, and settlements after backing up existing data.

## List usernames and password storage

```bash
scripts/list-usernames.py  # Docker by default
scripts/list-usernames.py --local --db /path/to/p60.sqlite3
sudo scripts/list-usernames.py --service
scripts/list-usernames.py --docker
scripts/list-usernames.py --docker --container p60-local
# For a running Docker app (replace the container name if needed):
docker exec p60-local python3 scripts/database.py usernames
```

The command prints account display names, one per line, using a read-only
connection. Login uses email addresses; display names are not unique login IDs.
It does not print emails, hashes, salts, or session tokens. An empty database
prints no names. A missing database produces an error without creating a file.
`--service` reads the service configuration and runs as its user. `--docker`
uses the app container image and volumes; select `--container NAME` if multiple
app containers exist. Both flags leave the app running (or stopped) as it was.
Use sudo when needed for Docker or service configuration access. Docker images must be rebuilt to include the new
`database.py usernames` command. Docker is the default when no deployment flag
is supplied. Use `--local` for the checkout database and current environment;
`--db` alone still selects a path inside Docker. `--service`, `--docker`, and
`--local` are mutually exclusive. Docker supports stopped containers as well as running ones.

Passwords are stored as scrypt hashes (`n=16384`, `r=8`, `p=1`) with a unique
random 16-byte salt per password. Signup and password changes store the hash
and salt; login verifies the derived hash with a constant-time comparison.
Original passwords cannot be retrieved by these tools. This protects password
values; it does not encrypt the whole SQLite database.

### Keep the local signup code across restarts

Run `python3 scripts/restart-server.py --signup-code` to enter the organizer code
privately. The restart helper saves it in ignored `data/local-signup-code` with
owner-only permissions and loads it on later restarts. A nonempty exported
`P60_SIGNUP_CODE` updates that saved value; explicitly exporting an empty value
disables signup for that run. Direct local `server.py` and VS Code launches also load the saved code when
`P60_SIGNUP_CODE` is unset. Explicit environment settings take precedence, and
production origins continue to require deployment environment configuration.
