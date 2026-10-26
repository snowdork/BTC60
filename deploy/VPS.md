# Shared VPS: BTC60 and Phunky

For now, run both applications on the same VPS with one host Caddy service
owning public ports 80/443. Each app has its own Compose project, private
loopback address, environment file, and lifecycle.

| Application | Public HTTPS address | Private upstream | Compose project | Configuration |
| --- | --- | --- | --- | --- |
| BTC60 / Predict60 | `predict60.com`, `predict60.free-vibe.com` | `127.0.0.1:8085` | `p60` | `compose.yaml`, `.env` |
| Phunky | `phunk.free-vibe.com` | `127.0.0.1:8086` | `phunky-game` | `compose.vps.yaml`, `.env.vps` |

All three DNS names point to the VPS. Separate hostnames and ports provide
unique addresses; separate public IP addresses are unnecessary.

## Configure and start the applications

In BTC60, copy `deploy/docker.env.example` to `.env` only on first setup.
Keep `P60_PORT=8085` and `P60_DOMAIN=predict60.com`. Follow
[Docker operation](DOCKER.md) for database import and backup before startup.

```bash
bash deploy/start-docker.sh
# Later source updates:
bash scripts/restart-docker.sh
curl --fail http://127.0.0.1:8085/healthz
```

In Phunky, copy `deploy/vps.env.example` to `.env.vps` only on first setup.
Set `PHUNK_PORT=8086`, `CADDY_NETWORK=phunky-vps`, and
`CADDY_NETWORK_EXTERNAL=false`. This creates a separate Docker network;
Phunky does not need to join BTC60's network when Caddy runs on the host.

```bash
sudo bash scripts/restart-docker.sh --vps
curl --fail http://127.0.0.1:8086/version.json
```

Run each command from its application's checkout. Do not start Phunky's
standalone `compose.yaml`, which includes another proxy. Do not use its
Docker-Caddy `scripts/deploy-vps.sh` helper for the host-proxy layout.

## Shared HTTPS configuration

Preserve all existing site blocks. Merge BTC60's `deploy/Caddyfile.vps` into
`/etc/caddy/Caddyfile`; it includes both BTC60 hostnames and Phunky on port 8086.
If Phunky's block already exists, replace it rather than adding a duplicate.
The resulting file must include both BTC60 hostnames and the Phunky hostname.
Use the default upstream ports above, or update the host proxy explicitly if
you change them: application `.env` files do not configure the Caddy service.
The Docker gateway `172.30.60.1` is the trusted proxy seen by BTC60, even though
host Caddy connects to its loopback publication. Keep the Compose subnet and
`P60_TRUSTED_PROXIES` setting aligned.

```bash
sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup-$(date -u +%Y%m%dT%H%M%SZ)"
# For the current two-app VPS, this file contains all three public hostnames.
# Merge any additional site blocks before installing if other apps are added.
sudo caddy validate --config deploy/Caddyfile.vps --adapter caddyfile
sudo install -m 644 deploy/Caddyfile.vps /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl --fail https://predict60.com/healthz
curl --fail https://predict60.free-vibe.com/healthz
curl --fail https://phunk.free-vibe.com/version.json
```

Run `bash deploy/check-vps.sh` from the VPS to check both private upstreams and
all three public endpoints. Any failed check produces a nonzero exit status.
If BTC60 returns 503, check the app on 8085 first; the old systemd upstream
`127.0.0.1:8000` is not the Docker deployment. An alias TLS failure also requires
checking its DNS and inclusion in the active Caddy configuration.

Application rebuilds do not install or reload the host Caddy configuration.
After changing proxy configuration, repeat the validation, installation, reload,
and public checks above. A healthy app container alone does not verify HTTPS.
If validation or reload fails, restore the saved Caddyfile, validate it, and
reload again. Keep server configuration backups outside the repository.

Enable Docker and host Caddy at boot. App containers use `unless-stopped`.
BTC60 keeps its existing `p60` project and database volume. Never delete
volumes during updates. Keep only one BTC60 process per database.

## Migration from the old Docker Caddy

Before changing a live VPS, inspect which proxy currently owns ports 80/443.
The older Phunky guides describe `p60-caddy-1` on `p60_p60`; that is the legacy
layout, not evidence of the current live state.

Back up the existing proxy configuration and certificate storage. Prepare and
validate a host configuration containing every existing site, and verify both
private upstreams first. Stop the old Caddy container using the old Compose
file before updating the BTC60 checkout; keep its volumes for rollback. Start
host Caddy once ports 80/443 are free, then verify all public URLs above.
Expect a brief HTTPS interruption during this proxy handoff. If verification
fails, stop host Caddy and restore the old proxy and configuration.

After successful cutover, remove only the stopped legacy proxy container.
Do not delete certificate volumes or the BTC60 database volume. Do not run
`deploy/enable-vps.sh`: it is a dedicated-host legacy installer.
