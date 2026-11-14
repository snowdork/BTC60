# Local testing and VPS setup

The setup helpers require Bash and Python 3.10+. Starting the app also requires
Docker Engine; VPS mode needs the Compose plugin. Run the commands from this
checkout. The helpers resolve their own paths, so they also work from another
directory when invoked by absolute path.

| Profile | Setup helper | Settings | App data |
| --- | --- | --- | --- |
| Local testing | `bash scripts/setup-local.sh` | `.env.local` | `p60-local-data` Docker volume |
| VPS production | `bash scripts/setup-vps.sh` | `.env` | Existing Compose `p60-data` volume |

Setup prompts for the port and Google web client ID.
VPS setup also asks for the public domain and additional browser origins. Codes
are entered privately and confirmed when the optional organizer-code gate is enabled. New files and update backups use mode 0600.
Existing profiles are validated and preserved; use `--update` to change them.
Registration is open without a code by default. Configure registration policy in
[`src/backend/CONST.py`](../src/backend/CONST.py):

| Constant | Default |
| --- | --- |
| `SIGNUP_CODE_REQUIRED` | `False` |

Rebuild/restart the app after
changing policy. With `SIGNUP_CODE_REQUIRED = True`, setup prompts for the code
and rejects a missing code; supply `P60_SIGNUP_CODE` for automated setup.

## Local testing

```bash
bash scripts/setup-local.sh
bash scripts/setup-local.sh --check
sudo bash scripts/setup-local.sh --start
```

Open the URL printed by setup. A new local profile uses port 8085, or 18085
when a VPS `.env` already exists (8085 if that VPS profile uses 18085).
You can choose a different port. Authorize the exact local HTTP origin in your
Google web client's JavaScript origins. Use `-` at the client-ID prompt to
disable Google sign-in when testing password registration only.

`--start` builds and replaces `p60-local`, preserving its data volume, and waits
for the app health check. A failed build leaves the running app untouched.
For subsequent source updates, run `sudo bash scripts/restart-docker.sh --local`.
See [local operation](LOCAL.md) for switching from the Python watchdog and logs.

## VPS production

```bash
bash scripts/setup-vps.sh
bash scripts/setup-vps.sh --check
sudo bash scripts/setup-vps.sh --start
```

Choose your production domain. On a new profile, an existing
`docker.env` is used to migrate settings, including its organizer code; review
these values in the prompts. The legacy file is preserved. Without that file,
the deployment template supplies defaults. A code is needed only when its gate
is enabled in `CONST.py`.

Point DNS at the VPS and configure the shared HTTPS proxy to forward the domain
to the printed loopback port. Authorize the primary HTTPS origin and any aliases
in Google. Setup does not install Docker, edit DNS, or change the shared proxy.
Follow [VPS HTTPS configuration](VPS.md#shared-https-configuration) and then run
`bash deploy/check-vps.sh` to check public HTTPS. Startup health checks verify the
app inside Docker; they do not verify DNS, Google credentials, or public HTTPS.

Before upgrading an existing production installation, take a database backup
using the procedures in [Docker operation](DOCKER.md#data-and-upgrades).
`--start` builds and updates only the app, preserving volumes and the shared
proxy. Compose replaces changed containers without forcing unchanged ones:

```bash
sudo bash scripts/setup-vps.sh --start
```

## Change or automate settings

```bash
bash scripts/setup-local.sh --update
bash scripts/setup-vps.sh --update
```

Updates preserve unrelated settings and create a timestamped private backup
beside the environment file. Changed settings reach running containers only
after the matching restart or `--start` command. `--check` only validates the
saved environment file and prints its profile; it changes no files or services.

For automation, run:

```bash
bash scripts/setup-local.sh --non-interactive
# Also supply P60_DOMAIN and any P60_ADDITIONAL_ORIGINS for production.
bash scripts/setup-vps.sh --non-interactive
```

`P60_PORT` and `GOOGLE_CLIENT_ID` can also be supplied through the environment.
For VPS automation, `P60_MAX_REQUESTS` (1–256), `PREDICT60_LOG_LEVEL`
(`normal`, `debug`, `warning`, or `error`), and `P60_IMAGE_TAG` are supported too.
Setup validates these values before saving or launching. Domain names and
additional origins are normalized to match backend validation. For local
Docker, managed values use plain unquoted `KEY=value` syntax; run `--update`
to normalize older quoted or `export` settings, which plain Docker interprets
differently from Compose. Checks of existing files include the defaults that
the runtime applies while still requiring an explicit VPS domain.
Use `--update --non-interactive` to apply overrides to an existing profile, and
add `--start` only when ready to deploy. The rollout uses the saved profile, so
shell overrides do not silently change the deployment after validation.

If the optional code gate is enabled and registration says “Signup is currently unavailable,” check the profile that
serves the browser's port. The VPS container reads `.env`; the local container
reads `.env.local`. Run that profile's setup with `--update`, configure its
organizer code, and apply it with `--start`. Local settings do not configure the
VPS container. No database reset is needed.

## Reset a database

To empty a test or production database after taking a safety backup, use
`sudo bash scripts/reset-local-database.sh --confirm-reset` or
`sudo bash scripts/reset-vps-database.sh --confirm-reset`. They restart only the
selected Docker app after a successful reset. See
[database reset procedures](../doc/DATABASE_MAINTENANCE.md#vps-and-local-docker-reset-scripts)
for the data cleared and failure behavior.

## Registration abuse controls

Both registration methods allow signup without an account cap or per-network
attempt/success limits. Existing signup-event records do not restrict registration.
The hidden website field rejects simple form bots, and general authentication
throttling remains active. Google signup still verifies Google's signed token,
origin and CSRF protection. Password signup does not verify email ownership.

## Login origins and localhost access

Password signup/login and Google authentication enforce the deployment's exact
browser origins. `P60_HOST` sets the primary origin; `P60_ADDITIONAL_ORIGINS`
adds comma-separated aliases. For `http://localhost:8085/signup.html` on the
public Docker stack, include `http://localhost:8085` in `.env` while preserving
existing public aliases. Keep `P60_HOST` on the public HTTPS origin.

Recreate the app container to apply environment changes; a container restart
alone retains its old environment. See [Docker login origin setup](DOCKER.md)
for the configuration and command. Database volumes are preserved. Google login
also requires the same origin in Google's Authorized JavaScript origins; that
setting does not replace the app's allowlist. Origin checks, CSRF protection,
and Google token verification remain enabled.
