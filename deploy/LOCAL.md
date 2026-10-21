# Local operation

Run commands from the repository root. Python 3.10+ and internet access are
required for live feeds; the app runtime has no pip or npm dependencies. Node.js
is needed for JavaScript tests. The full test runner and watchdog target Linux.

## Python

```bash
# Read a signup code without storing it in shell history (Bash).
read -rs -p 'Local signup code: ' P60_SIGNUP_CODE
export P60_SIGNUP_CODE
python3 server.py --bind 127.0.0.1 --port 8000
```

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
python3 scripts/stop-server.py
```

Use these instead of running a second direct process. Logs rotate under
`/tmp/p60`; the watchdog is not a boot-time service. See the main README for log
levels. For startup at boot on a VPS use systemd or Docker.

## Docker

```bash
cp -n deploy/local.env.example .env.local
chmod 600 .env.local
# Edit .env.local; change the example signup code if desired.
bash scripts/restart-docker.sh --local
```

Open **http://localhost:8080** (use this hostname to match the configured origin).
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

## Checks and common problems

```bash
curl --fail http://127.0.0.1:8000/healthz  # Python
curl --fail http://localhost:8080/healthz # Docker
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
